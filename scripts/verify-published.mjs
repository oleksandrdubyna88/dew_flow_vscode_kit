#!/usr/bin/env node
/**
 * verify-published — what GitHub Packages SERVES for one version of this package, after `release.yml`
 * publishes it and whenever POST_DEPLOY.md is run (E3.S2, `research/PLAN_publish_to_github_packages.md`; the
 * family rule "verify the ARTEFACT, not the source").
 *
 *     node scripts/verify-published.mjs [<version>] [--tarball <file>] [--check version|integrity|attestation|visibility]...
 *     node scripts/verify-published.mjs --facts <file>          # the decision alone, over recorded facts
 *
 * The version is the argument, else `$TARGET` (how post-deploy-check hands it over), and must be
 * `<major>.<minor>.<patch>` — no `v`. `--check` is repeatable and defaults to all four. GitHub Packages
 * serves nothing without a token, so `$NODE_AUTH_TOKEN` must be set (in CI the job's `GITHUB_TOKEN` with
 * `packages: read`; locally a classic personal access token with `read:packages`) and `gh` must be logged in
 * (`$GH_TOKEN` in CI) — an empty token is exit 2 naming both, before anything is asked.
 *
 *   version      `npm view <name>@<version> --json` answers that name at that version. Retried for up to
 *                about two minutes, because a version just published takes a moment to be served.
 *   integrity    the SERVED tarball — downloaded with `npm pack <name>@<version>` — has the sha512 the
 *                packument calls `dist.integrity`; with `--tarball <file>` that file (the one the job
 *                attested and published) has the same sha512, so the bytes attested are the bytes served.
 *   attestation  `gh attestation verify <served tarball>` accepts it for THIS repository, with this
 *                repository's `.github/workflows/release.yml` at `refs/tags/v<version>` on a GitHub-hosted
 *                runner. The decision does not trust the flags alone: it reads gh's JSON back and wants ONE
 *                entry whose certificate names that identity, ref and runner, whose statement is SLSA v1
 *                provenance, and whose subject sha256 is the served file's.
 *   visibility   `gh api /users/<owner>/packages/npm/<name>` says `public`. Needs `read:packages`, which a
 *                job's token has only when granted, so release.yml does not run it — POST_DEPLOY.md does.
 *
 * Exit: 0 every check passed; 1 a check failed (each failure printed); 2 usage, or facts that could not be
 * gathered or read. The decision (`verdict`) is a pure function of the facts, held by the suite through
 * `--facts`; the gathering is npm, gh and nothing else, each under a timeout. The token is never printed.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { childEnv, npmCli, registryEnv, repositoryOwnerAndName } from './lib/npm.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const WORKFLOW = '.github/workflows/release.yml';
const SLSA_V1 = 'https://slsa.dev/provenance/v1';
const GITHUB_HOSTED = 'github-hosted';
const VERSION_SHAPE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const CHECKS = ['version', 'integrity', 'attestation', 'visibility'];
const CHILD_TIMEOUT_MS = 120_000;
const GH_TIMEOUT_MS = 120_000;
const VIEW_ATTEMPTS = 12;
const VIEW_PAUSE_MS = 10_000;

/** The npm name without its scope — what GitHub's REST calls the package. */
export function packageName(name) {
  return name.replace(/^@[^/]+\//, '');
}

/** What every check compares against: this package, at this version, from this repository's release workflow. */
export function expectedFor(manifest, version) {
  const { owner, repo } = repositoryOwnerAndName(manifest.repository);
  const ref = `refs/tags/v${version}`;

  return {
    name: manifest.name,
    version,
    owner,
    repo,
    registry: manifest.publishConfig?.registry,
    workflow: WORKFLOW,
    ref,
    identity: `https://github.com/${owner}/${repo}/${WORKFLOW}@${ref}`,
  };
}

/** The sha512 (npm's `sha512-<base64>`) and sha256 (an in-toto subject digest, hex) of one file. */
export function hashes(file) {
  const bytes = readFileSync(file);

  return {
    file: basename(file),
    sha512: `sha512-${createHash('sha512').update(bytes).digest('base64')}`,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  };
}

function versionProblems({ expected, view }) {
  if (view === null || view === undefined) {
    return [`npm view ${expected.name}@${expected.version} answered nothing — that version is not served`];
  }

  return view.name === expected.name && view.version === expected.version
    ? []
    : [`npm view answered ${view.name}@${view.version}, not ${expected.name}@${expected.version}`];
}

/** The served bytes against the packument: `dist.integrity` must be a sha512 and must be the served file's. */
function packumentProblems(view, served) {
  const integrity = view?.dist?.integrity;
  if (typeof integrity !== 'string' || !integrity.startsWith('sha512-')) {
    return ['the packument carries no sha512 dist.integrity'];
  }

  return served.sha512 === integrity ? [] : [`the served tarball's sha512 is not dist.integrity (served ${served.sha512}, packument ${integrity})`];
}

/** The served bytes against the file the job attested: one sha512, or the job attested another archive. */
function localProblems(served, local) {
  if (local === null || local === undefined || local.sha512 === served.sha512) {
    return [];
  }

  return [`the attested tarball ${local.file} is not the served tarball — sha512 differ (attested ${local.sha512}, served ${served.sha512})`];
}

function integrityProblems({ expected, view, served, local }) {
  if (served === null || served === undefined) {
    return [`the served tarball was not downloaded — npm pack ${expected.name}@${expected.version} left nothing`];
  }

  return [...packumentProblems(view, served), ...localProblems(served, local)];
}

const certificateOf = (entry) => entry?.verificationResult?.signature?.certificate;
const statementOf = (entry) => entry?.verificationResult?.statement;

/**
 * What ONE attestation entry must say — data, not branches. `seen` is how a refusal shows what the entries
 * said instead (absent: nothing worth quoting).
 */
function conditions(expected, served) {
  return [
    {
      why: `no entry's certificate subjectAlternativeName is "${expected.identity}"`,
      seen: (entry) => certificateOf(entry)?.subjectAlternativeName,
      ok: (entry) => certificateOf(entry)?.subjectAlternativeName === expected.identity,
    },
    {
      why: `no entry's certificate runnerEnvironment is "${GITHUB_HOSTED}"`,
      seen: (entry) => certificateOf(entry)?.runnerEnvironment,
      ok: (entry) => certificateOf(entry)?.runnerEnvironment === GITHUB_HOSTED,
    },
    {
      why: `no entry's certificate sourceRepositoryRef is "${expected.ref}"`,
      seen: (entry) => certificateOf(entry)?.sourceRepositoryRef,
      ok: (entry) => certificateOf(entry)?.sourceRepositoryRef === expected.ref,
    },
    {
      why: `no entry's statement predicateType is "${SLSA_V1}"`,
      seen: (entry) => statementOf(entry)?.predicateType,
      ok: (entry) => statementOf(entry)?.predicateType === SLSA_V1,
    },
    {
      why: `no entry's statement subject carries sha256 ${served.sha256} — the served tarball's`,
      ok: (entry) => (statementOf(entry)?.subject ?? []).some((subject) => subject?.digest?.sha256 === served.sha256),
    },
  ];
}

/** The refusal of one unmet condition, with the distinct values the entries had in its place. */
function unmetLine({ why, seen }, entries) {
  if (seen === undefined) {
    return why;
  }

  return `${why} (seen: ${[...new Set(entries.map((entry) => String(seen(entry) ?? '(none)')))].join(', ')})`;
}

/** Whether ONE entry meets every condition; else each condition no entry meets, else that they are split. */
function entryProblems(expected, served, entries) {
  const wanted = conditions(expected, served);
  if (entries.some((entry) => wanted.every(({ ok }) => ok(entry)))) {
    return [];
  }
  const unmet = wanted.filter(({ ok }) => !entries.some((entry) => ok(entry)));

  return unmet.length === 0 ? ['no single entry meets every condition'] : unmet.map((condition) => unmetLine(condition, entries));
}

function attestationProblems({ expected, served, attestation }) {
  if (served === null || served === undefined) {
    return ['the served tarball was not downloaded, so nothing was verified'];
  }
  if (attestation === null || attestation === undefined) {
    return ['gh attestation verify did not run'];
  }
  if (attestation.status !== 0) {
    return [`gh attestation verify exited ${attestation.status}\n${attestation.stderr ?? ''}`.trimEnd()];
  }

  return Array.isArray(attestation.entries) && attestation.entries.length > 0
    ? entryProblems(expected, served, attestation.entries)
    : ['gh answered no attestation entry'];
}

function visibilityProblems({ expected, visibility }) {
  const pkg = packageName(expected.name);
  const path = `/users/${expected.owner}/packages/npm/${pkg}`;
  if (visibility === null || visibility === undefined) {
    return ['gh api did not run'];
  }
  if (visibility.status !== 0) {
    return [`gh api ${path} exited ${visibility.status}\n${visibility.stderr ?? ''}`.trimEnd()];
  }
  const seen = visibility.answer?.visibility;

  return seen === 'public'
    ? []
    : [`the package is "${seen}", not public — the owner's click: https://github.com/${expected.owner}/${expected.repo}/pkgs/npm/${pkg} → Package settings → Danger Zone → Change visibility → Public (irreversible)`];
}

const DECIDE = { version: versionProblems, integrity: integrityProblems, attestation: attestationProblems, visibility: visibilityProblems };

/** The decision over gathered facts: `{ code, lines }`, every failed check listed, nothing gathered here. */
export function verdict(facts, checks = CHECKS) {
  const failed = checks.flatMap((check) => DECIDE[check](facts).map((why) => `${check}: ${why}`));
  const subject = `${facts.expected.name}@${facts.expected.version}`;

  return failed.length === 0
    ? { code: 0, lines: [`verify-published: ok — ${subject}: ${checks.join(', ')}`] }
    : { code: 1, lines: [`verify-published: ${subject} FAILED`, ...failed.map((why) => `  - ${why}`)] };
}

/** The last lines of a child's output, for a failure message. */
function tail(text, lines = 40) {
  return (text ?? '').trimEnd().split(/\r?\n/).slice(-lines).join('\n');
}

/** `node npm-cli.js <args>` in `cwd`, in the registry environment, under a timeout. */
function npm(args, cwd, env) {
  const result = spawnSync(process.execPath, [npmCli(), ...args], { cwd, env, encoding: 'utf8', timeout: CHILD_TIMEOUT_MS, killSignal: 'SIGKILL' });
  if (result.error !== undefined) {
    throw new Error(`npm ${args[0]} did not run: ${result.error.message}`);
  }

  return result;
}

/** `gh <args>` in `cwd` under a timeout; gh's absence is a gathering error, its exit code a fact. */
function gh(args, cwd) {
  const result = spawnSync('gh', args, { cwd, env: childEnv(), encoding: 'utf8', timeout: GH_TIMEOUT_MS, killSignal: 'SIGKILL' });
  if (result.error !== undefined) {
    throw new Error(`gh did not run: ${result.error.message} — gh is preinstalled on GitHub-hosted runners; locally install GitHub CLI and log in`);
  }

  return result;
}

const pause = (ms) => new Promise((done) => { setTimeout(done, ms); });

/** The packument for exactly that version, or null when npm still answers nothing after every attempt. */
async function view(expected, dir, env) {
  for (let attempt = 1; attempt <= VIEW_ATTEMPTS; attempt += 1) {
    const result = npm(['view', `${expected.name}@${expected.version}`, '--json'], dir, env);
    const text = result.status === 0 ? result.stdout.trim() : '';
    if (text !== '') {
      return JSON.parse(text);
    }
    if (attempt < VIEW_ATTEMPTS) {
      // Progress on STDOUT: stderr carries only the verdict, so a caller showing a failure's first stderr
      // line (post-deploy-check does) shows why it failed rather than that it waited.
      process.stdout.write(`verify-published: ${expected.name}@${expected.version} not served yet (attempt ${attempt}/${VIEW_ATTEMPTS}); waiting\n`);
      await pause(VIEW_PAUSE_MS);
    }
  }

  return null;
}

/** The tarball the registry SERVES: `npm pack <name>@<version>` downloads it. `{ path, served }`, or nulls when nothing came. */
function download(expected, dir, env) {
  const destination = join(dir, 'served');
  mkdirSync(destination);
  const result = npm(['pack', `${expected.name}@${expected.version}`, '--pack-destination', destination], dir, env);
  const tarballs = result.status === 0 ? readdirSync(destination).filter((file) => file.endsWith('.tgz')) : [];
  if (tarballs.length !== 1) {
    return { path: null, served: null };
  }
  const path = join(destination, tarballs[0]);

  return { path, served: hashes(path) };
}

/** `gh attestation verify` over the served file, with the identity this repository's release is expected to have. */
function attest(expected, servedPath, dir) {
  const args = ['attestation', 'verify', servedPath, '--repo', `${expected.owner}/${expected.repo}`, '--cert-identity', expected.identity,
    '--source-ref', expected.ref, '--deny-self-hosted-runners', '--format', 'json'];
  const result = gh(args, dir);

  return { status: result.status, stderr: tail(result.stderr), entries: result.status === 0 ? JSON.parse(result.stdout) : [] };
}

/** What GitHub's REST says about the package: `gh api /users/<owner>/packages/npm/<name>`. */
function visibilityOf(expected, dir) {
  const result = gh(['api', `/users/${expected.owner}/packages/npm/${packageName(expected.name)}`], dir);

  return { status: result.status, stderr: tail(result.stderr), answer: result.status === 0 ? JSON.parse(result.stdout) : null };
}

const asked = (checks, ...names) => names.some((name) => checks.includes(name));

/**
 * Every fact the checks need, from GitHub Packages and gh; a throwaway directory removed pass or fail. The
 * registry environment is built FIRST, so an empty token stops here before anything is asked.
 */
export async function gather(manifest, expected, checks, tarball) {
  const dir = mkdtempSync(join(tmpdir(), 'kit-verify-published-'));
  try {
    const env = registryEnv(dir, manifest);
    const packument = asked(checks, 'version', 'integrity') ? await view(expected, dir, env) : null;
    const { path, served } = asked(checks, 'integrity', 'attestation') ? download(expected, dir, env) : { path: null, served: null };

    return {
      expected,
      view: packument,
      served,
      local: tarball === undefined ? null : hashes(tarball),
      attestation: path !== null && checks.includes('attestation') ? attest(expected, path, dir) : null,
      visibility: checks.includes('visibility') ? visibilityOf(expected, dir) : null,
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const USAGE = 'usage: node scripts/verify-published.mjs [<version>] [--tarball <file>] [--check version|integrity|attestation|visibility]... | --facts <file>';

/** `{ facts }` mode's own usage errors, or undefined. */
function factsUsage(parsed) {
  if (parsed.positionals.length > 0) {
    return '--facts takes no version';
  }

  return parsed.values.tarball === undefined ? undefined : '--facts takes no --tarball';
}

/** The arguments as `{ facts, checks }` or `{ version, checks, tarball }`, or `{ usage }` naming what is wrong. */
function readArguments(argv, env) {
  let parsed;
  try {
    parsed = parseArgs({ args: argv, allowPositionals: true, options: { check: { type: 'string', multiple: true, default: [] }, facts: { type: 'string' }, tarball: { type: 'string' } } });
  } catch (error) {
    return { usage: error.message };
  }
  const unknown = parsed.values.check.find((check) => !CHECKS.includes(check));
  if (unknown !== undefined) {
    return { usage: `--check is one of ${CHECKS.join(', ')}, not "${unknown}"` };
  }
  const checks = parsed.values.check.length === 0 ? CHECKS : parsed.values.check;
  const { facts, tarball } = parsed.values;
  if (facts !== undefined) {
    const usage = factsUsage(parsed);

    return usage === undefined ? { facts, checks } : { usage };
  }
  const version = parsed.positionals[0] ?? env.TARGET ?? '';
  if (parsed.positionals.length > 1 || !VERSION_SHAPE.test(version)) {
    return { usage: `one version <major>.<minor>.<patch> is needed (an argument or $TARGET), got "${parsed.positionals.join(' ') || version}"` };
  }
  if (tarball !== undefined && !existsSync(tarball)) {
    return { usage: `--tarball ${tarball} does not exist` };
  }

  return { version, checks, tarball };
}

async function main(argv) {
  const args = readArguments(argv, process.env);
  if (args.usage !== undefined) {
    console.error(`${args.usage}\n${USAGE}`);
    return 2;
  }
  let facts;
  try {
    const manifest = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
    facts = args.facts !== undefined
      ? JSON.parse(readFileSync(args.facts, 'utf8'))
      : await gather(manifest, expectedFor(manifest, args.version), args.checks, args.tarball);
  } catch (error) {
    console.error(`verify-published: could not gather what to check: ${error.message}`);
    return 2;
  }
  if (typeof facts?.expected?.name !== 'string' || typeof facts.expected.version !== 'string') {
    console.error('verify-published: the facts carry no expected name and version.');
    return 2;
  }
  const { code, lines } = verdict(facts, args.checks);
  (code === 0 ? console.log : console.error)(lines.join('\n'));

  return code;
}

const self = fileURLToPath(import.meta.url);
if (process.argv[1] && resolve(process.argv[1]) === self) {
  process.exitCode = await main(process.argv.slice(2));
}
