#!/usr/bin/env node
/**
 * publish-once — the release job's publish step: `npm publish <tarball>` to GitHub Packages, but only when the
 * registry does not already serve this package at this version (E3.S2, `todo/PLAN_publish_to_github_packages.md`).
 *
 *     node scripts/publish-once.mjs <tarball.tgz>
 *     node scripts/publish-once.mjs --facts <file>          # the decision alone, over recorded facts
 *
 * Why it exists: a publish can succeed and the run can still fail after it (the runner dies, a later step
 * errors). npm refuses to publish over an existing version, so a plain `npm publish` in the re-run would
 * fail on a version that is in fact fine. This script publishes NOTHING when `<name>@<version>` is already
 * served, says so, and exits 0 — and the verify step that follows decides whether what is served is THIS
 * run's attested bytes. A version that is served but is not those bytes stays red there, and is a bad
 * release, fixed forward.
 *
 *   served      `npm view <name>@<version> --json` answers that name at that version → skip.
 *   not served  anything else — no answer, an `E404`, another version or name → `npm publish <tarball>`.
 *
 * The tarball is the ONE the job packed and attested; it must exist and be named as `npm pack` names a
 * tarball of THIS package.json (`<scope>-<name>-<version>.tgz`), so a stray file cannot be published in its
 * place. `npm publish <tarball>` runs NO lifecycle script (npm runs `prepublishOnly` only for a directory),
 * so what guards the published bytes is the job's own `npm test` and the `prepack` build in the pack step.
 *
 * Both npm children read `registryEnv`'s user config (`lib/npm.mjs`) — the same file for the question and
 * the publish — not the job's own `.npmrc`, which `childEnv` strips with every other `npm_*` variable. An
 * empty `NODE_AUTH_TOKEN` is exit 2 before any npm starts. The token is never printed; npm's own output is
 * printed as it is (npm redacts tokens).
 *
 * Exit: 0 published, or nothing to publish; 1 `npm publish` failed; 2 usage, or the registry could not be
 * asked (never publish on an answer this script did not understand). The decision (`decide`) is a pure
 * function of the facts, held by the suite through `--facts`, which spawns nothing.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { npmCli, registryEnv } from './lib/npm.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const VIEW_TIMEOUT_MS = 120_000;
const PUBLISH_TIMEOUT_MS = 180_000;
const RETRY_PAUSE_MS = 10_000;
const USAGE = 'usage: node scripts/publish-once.mjs <tarball.tgz> | --facts <file>';

/** The name `npm pack` gives the tarball of `<name>@<version>`: `@scope/pkg` → `scope-pkg-<version>.tgz`. */
export function packName({ name, version }) {
  return `${name.replace(/^@/, '').replace('/', '-')}-${version}.tgz`;
}

/** The decision over facts: `{ action: 'skip' | 'publish', line }`, nothing asked or spawned here. */
export function decide({ expected, view }) {
  const subject = `${expected.name}@${expected.version}`;
  const served = view !== null && typeof view === 'object' && view.name === expected.name && view.version === expected.version;

  return served
    ? { action: 'skip', line: `${subject} is already served — publishing nothing; the verify step decides whether the served bytes are this run's attested bytes` }
    : { action: 'publish', line: `${subject} is not served — publishing ${packName(expected)}` };
}

/** The arguments as `{ facts }` or `{ tarball }`, or `{ usage }` naming what is wrong. */
function readArguments(argv) {
  let parsed;
  try {
    parsed = parseArgs({ args: argv, allowPositionals: true, options: { facts: { type: 'string' } } });
  } catch (error) {
    return { usage: error.message };
  }
  const { facts } = parsed.values;
  if (facts !== undefined) {
    return parsed.positionals.length === 0 ? { facts } : { usage: '--facts takes no tarball' };
  }

  return parsed.positionals.length === 1 ? { tarball: parsed.positionals[0] } : { usage: `one tarball is needed, got "${parsed.positionals.join(' ')}"` };
}

/** Why a live-mode tarball cannot be the one to publish, or '' when it can. */
function tarballProblem(tarball, expected) {
  if (!existsSync(tarball)) {
    return `${tarball} does not exist`;
  }

  return basename(tarball) === packName(expected)
    ? ''
    : `${basename(tarball)} is not the tarball npm pack makes for ${expected.name}@${expected.version} (${packName(expected)})`;
}

const pause = (ms) => new Promise((done) => { setTimeout(done, ms); });

/** The last lines of a child's output, for a failure message. */
function tail(text, lines = 40) {
  return (text ?? '').trimEnd().split(/\r?\n/).slice(-lines).join('\n');
}

/** `node npm-cli.js <args>` in the repository, under a timeout and in `env`. */
function npm(args, env, timeout) {
  const result = spawnSync(process.execPath, [npmCli(), ...args], { cwd: ROOT, env, encoding: 'utf8', timeout, killSignal: 'SIGKILL' });
  if (result.error !== undefined) {
    throw new Error(`npm ${args[0]} did not run: ${result.error.message}`);
  }

  return result;
}

/** What `npm view` said, as the packument object, or null for "this version is not served"; undefined for anything else. */
function understood(result) {
  const text = result.stdout.trim();
  if (result.status === 0) {
    return text === '' ? null : JSON.parse(text);
  }
  try {
    return JSON.parse(text)?.error?.code === 'E404' ? null : undefined;
  } catch {
    return undefined;
  }
}

/** The packument of `<name>@<version>`, or null when it is not served; one retry, then a throw for any other answer. */
async function view(expected, env) {
  // On STDOUT, before anything is asked: a registry question that is asked without a token shows here.
  console.log(`publish-once: asking the registry whether ${expected.name}@${expected.version} is served`);
  const args = ['view', `${expected.name}@${expected.version}`, '--json'];
  let result = npm(args, env, VIEW_TIMEOUT_MS);
  if (understood(result) === undefined) {
    console.log(`publish-once: the registry's answer was not understood (exit ${result.status ?? result.signal}); asking once more in ${RETRY_PAUSE_MS / 1000} s`);
    await pause(RETRY_PAUSE_MS);
    result = npm(args, env, VIEW_TIMEOUT_MS);
  }
  const answer = understood(result);
  if (answer === undefined) {
    throw new Error(`npm view exited ${result.status ?? result.signal} with an answer that is not "not served"\n${tail(result.stderr)}`);
  }

  return answer;
}

/** Reads the facts file; null when it does not carry the name and version to decide on. */
function readFacts(file) {
  const facts = JSON.parse(readFileSync(file, 'utf8'));

  return typeof facts?.expected?.name === 'string' && typeof facts.expected.version === 'string' ? facts : null;
}

function decideFromFacts(file) {
  let facts;
  try {
    facts = readFacts(file);
  } catch (error) {
    console.error(`publish-once: could not read the facts: ${error.message}`);
    return 2;
  }
  if (facts === null) {
    console.error('publish-once: the facts carry no expected name and version.');
    return 2;
  }
  const { action, line } = decide({ expected: facts.expected, view: facts.view ?? null });
  console.log(`publish-once: ${line}\npublish-once: decision ${action}`);

  return 0;
}

/** `npm publish <tarball>` in the same npm config the question used; 0 when it published. */
function publish(tarball, env) {
  const result = npm(['publish', tarball], env, PUBLISH_TIMEOUT_MS);
  process.stdout.write(result.stdout);
  process.stderr.write(result.stderr);
  if (result.status === 0) {
    console.log(`publish-once: published ${basename(tarball)}`);
    return 0;
  }
  console.error(`publish-once: npm publish exited ${result.status ?? result.signal}\n${tail(result.stderr)}`);

  return 1;
}

async function publishLive(tarball, dir) {
  const manifest = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  const expected = { name: manifest.name, version: manifest.version };
  const problem = tarballProblem(tarball, expected);
  if (problem !== '') {
    console.error(`${problem}\n${USAGE}`);
    return 2;
  }
  let env;
  let served;
  try {
    env = registryEnv(dir, manifest);
    served = await view(expected, env);
  } catch (error) {
    console.error(`publish-once: could not ask the registry: ${error.message}`);
    return 2;
  }
  const { action, line } = decide({ expected, view: served });
  console.log(`publish-once: ${line}\npublish-once: decision ${action}`);

  return action === 'skip' ? 0 : publish(tarball, env);
}

async function main(argv) {
  const args = readArguments(argv);
  if (args.usage !== undefined) {
    console.error(`${args.usage}\n${USAGE}`);
    return 2;
  }
  if (args.facts !== undefined) {
    return decideFromFacts(args.facts);
  }
  const dir = mkdtempSync(join(tmpdir(), 'kit-publish-once-'));
  try {
    return await publishLive(args.tarball, dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const self = fileURLToPath(import.meta.url);
if (process.argv[1] && resolve(process.argv[1]) === self) {
  process.exitCode = await main(process.argv.slice(2));
}
