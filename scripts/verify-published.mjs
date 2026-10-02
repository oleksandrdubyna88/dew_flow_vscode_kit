#!/usr/bin/env node
/**
 * verify-published — what npmjs SERVES for one version of this package, asked as anybody would (no token,
 * no user config), after `release.yml` publishes it and whenever POST_DEPLOY.md is run (E3.S2,
 * `todo/PLAN_extract_the_kit.md`; the family rule "verify the ARTEFACT, not the source").
 *
 *     node scripts/verify-published.mjs [<version>] [--check version|provenance|signatures|all]
 *     node scripts/verify-published.mjs --facts <file>          # the decision alone, over recorded facts
 *
 * The version is the argument, else `$TARGET` (how post-deploy-check hands it over), and must be
 * `<major>.<minor>.<patch>` — no `v`. `--check` defaults to `all`.
 *
 *   version     `npm view <name>@<version> --json` answers that name at that version. Retried for up to
 *               about two minutes, because a version just published takes a moment to be served.
 *   provenance  the packument's `dist.attestations` names a SLSA v1 provenance statement; the statement,
 *               fetched from the registry, is about THIS tarball (its subject is `pkg:npm/<name>@<version>`
 *               with the sha512 of `dist.integrity`) and was built by THIS repository's
 *               `.github/workflows/release.yml` at `refs/tags/v<version>` — the identity README "Release
 *               and rollback" names.
 *   signatures  `npm audit signatures` in a throwaway install of exactly that version: one package with a
 *               verified registry signature AND a verified attestation — npm checking the sigstore bundle,
 *               which this script does not try to do itself.
 *
 * Exit: 0 every check passed; 1 a check failed (each failure printed); 2 usage, or facts that could not be
 * gathered or read. The decision (`verdict`) is a pure function of the facts, held by the suite through
 * `--facts`; the gathering is npm and one HTTPS fetch, each under a timeout.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { anonymousEnv, npmCli } from './lib/npm.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const WORKFLOW = '.github/workflows/release.yml';
const SLSA_V1 = 'https://slsa.dev/provenance/v1';
const VERSION_SHAPE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const CHECKS = ['version', 'provenance', 'signatures'];
const CHILD_TIMEOUT_MS = 120_000;
const FETCH_TIMEOUT_MS = 30_000;
const VIEW_ATTEMPTS = 12;
const VIEW_PAUSE_MS = 10_000;

/** `git+https://github.com/o/r.git` (or `github:o/r`) as `https://github.com/o/r`, the form provenance carries. */
export function repositoryUrl(repository) {
  const url = typeof repository === 'string' ? repository : repository?.url ?? '';

  return url.replace(/^git\+/, '').replace(/^github:/, 'https://github.com/').replace(/\.git$/, '');
}

/** What every check compares against: this package, at this version, from this repository's release workflow. */
export function expectedFor(manifest, version) {
  return { name: manifest.name, version, repository: repositoryUrl(manifest.repository), workflow: WORKFLOW, ref: `refs/tags/v${version}` };
}

/** `sha512-<base64>` as lower-case hex, the form an in-toto subject digest carries; '' for anything else. */
function integrityHex(integrity) {
  const match = /^sha512-([A-Za-z0-9+/=]+)$/.exec(integrity ?? '');

  return match === null ? '' : Buffer.from(match[1], 'base64').toString('hex');
}

function versionProblems({ expected, view }) {
  if (view === null || view === undefined) {
    return [`npm view ${expected.name}@${expected.version} answered nothing — that version is not served`];
  }

  return view.name === expected.name && view.version === expected.version
    ? []
    : [`npm view answered ${view.name}@${view.version}, not ${expected.name}@${expected.version}`];
}

function identityProblems(expected, statement) {
  const workflow = statement?.predicate?.buildDefinition?.externalParameters?.workflow ?? {};
  const wanted = { repository: expected.repository, path: expected.workflow, ref: expected.ref };

  return Object.entries(wanted)
    .filter(([key, value]) => workflow[key] !== value)
    .map(([key, value]) => `the provenance names workflow ${key} "${workflow[key] ?? '(none)'}", not "${value}"`);
}

function subjectProblems(expected, view, statement) {
  const subject = statement?.subject?.[0];
  const name = `pkg:npm/${expected.name.replace(/^@/, '%40')}@${expected.version}`;
  const problems = subject?.name === name ? [] : [`the provenance is about "${subject?.name ?? '(nothing)'}", not "${name}"`];
  const digest = integrityHex(view?.dist?.integrity);

  return digest !== '' && subject?.digest?.sha512 === digest
    ? problems
    : [...problems, 'the provenance\'s sha512 is not the served tarball\'s integrity'];
}

function provenanceProblems({ expected, view, statement }) {
  if (view?.dist?.attestations?.provenance?.predicateType !== SLSA_V1) {
    return [`${expected.name}@${expected.version} carries no SLSA v1 provenance (dist.attestations) — was it published with --provenance from CI?`];
  }
  if (statement === null || statement === undefined || statement.predicateType !== SLSA_V1) {
    return ['the registry served no SLSA v1 provenance statement for it'];
  }

  return [...subjectProblems(expected, view, statement), ...identityProblems(expected, statement)];
}

function signatureProblems({ audit }) {
  if (audit === null || audit === undefined) {
    return ['npm audit signatures did not run'];
  }
  const said = `${audit.stdout ?? ''}`;
  const problems = [
    [audit.status === 0, `npm audit signatures exited ${audit.status}`],
    [/^1 package has a verified registry signature$/m.test(said), 'npm audit signatures did not report one package with a verified registry signature'],
    [/^1 package has a verified attestation$/m.test(said), 'npm audit signatures did not report one package with a verified attestation'],
  ];

  return problems.filter(([ok]) => !ok).map(([, why]) => `${why}\n${said.trim()}`);
}

const DECIDE = { version: versionProblems, provenance: provenanceProblems, signatures: signatureProblems };

/** The decision over gathered facts: `{ code, lines }`, every failed check listed, nothing gathered here. */
export function verdict(facts, checks = CHECKS) {
  const failed = checks.flatMap((check) => DECIDE[check](facts).map((why) => `${check}: ${why}`));
  const subject = `${facts.expected.name}@${facts.expected.version}`;

  return failed.length === 0
    ? { code: 0, lines: [`verify-published: ok — ${subject}: ${checks.join(', ')}`] }
    : { code: 1, lines: [`verify-published: ${subject} FAILED`, ...failed.map((why) => `  - ${why}`)] };
}

/** `node npm-cli.js <args>` in `cwd`, anonymously, under a timeout. */
function npm(args, cwd, env) {
  const result = spawnSync(process.execPath, [npmCli(), ...args], { cwd, env, encoding: 'utf8', timeout: CHILD_TIMEOUT_MS, killSignal: 'SIGKILL' });
  if (result.error !== undefined) {
    throw new Error(`npm ${args[0]} did not run: ${result.error.message}`);
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

/** The SLSA v1 statement the registry holds for that version, decoded from its DSSE envelope; null when none. */
async function statementOf(packument) {
  const url = packument?.dist?.attestations?.url;
  if (typeof url !== 'string' || !url.startsWith('https://registry.npmjs.org/')) {
    return null;
  }
  const response = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!response.ok) {
    throw new Error(`GET ${url} answered ${response.status}`);
  }
  const found = (await response.json()).attestations?.find((entry) => entry.predicateType === SLSA_V1);
  const payload = found?.bundle?.dsseEnvelope?.payload;

  return typeof payload === 'string' ? JSON.parse(Buffer.from(payload, 'base64').toString('utf8')) : null;
}

/** `npm audit signatures` over a throwaway install of exactly that version. */
function audit(expected, dir, env) {
  writeFileSync(join(dir, 'package.json'), `${JSON.stringify({ name: 'verify-published', version: '0.0.0', private: true })}\n`);
  const install = npm(['install', `${expected.name}@${expected.version}`, '--save-exact', '--ignore-scripts', '--no-fund', '--no-audit'], dir, env);
  if (install.status !== 0) {
    return { status: install.status, stdout: `npm install failed:\n${install.stderr.trim()}` };
  }
  const result = npm(['audit', 'signatures'], dir, env);

  return { status: result.status, stdout: `${result.stdout}${result.stderr}` };
}

/** Every fact the checks need, from the registry, anonymously; a throwaway directory removed pass or fail. */
export async function gather(expected, checks) {
  const dir = mkdtempSync(join(tmpdir(), 'kit-verify-published-'));
  try {
    const env = anonymousEnv(dir);
    const packument = await view(expected, dir, env);
    const statement = checks.includes('provenance') ? await statementOf(packument) : null;
    const signatures = checks.includes('signatures') ? audit(expected, dir, env) : null;

    return { expected, view: packument, statement, audit: signatures };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const USAGE = 'usage: node scripts/verify-published.mjs [<version>] [--check version|provenance|signatures|all] | --facts <file>';

/** The arguments as `{ facts }` or `{ version, checks }`, or `{ usage }` naming what is wrong. */
function readArguments(argv, env) {
  let parsed;
  try {
    parsed = parseArgs({ args: argv, allowPositionals: true, options: { check: { type: 'string', default: 'all' }, facts: { type: 'string' } } });
  } catch (error) {
    return { usage: error.message };
  }
  const { check, facts } = parsed.values;
  if (check !== 'all' && !CHECKS.includes(check)) {
    return { usage: `--check is one of ${CHECKS.join(', ')} or all, not "${check}"` };
  }
  const checks = check === 'all' ? CHECKS : [check];
  if (facts !== undefined) {
    return parsed.positionals.length === 0 ? { facts, checks } : { usage: '--facts takes no version' };
  }
  const version = parsed.positionals[0] ?? env.TARGET ?? '';
  if (parsed.positionals.length > 1 || !VERSION_SHAPE.test(version)) {
    return { usage: `one version <major>.<minor>.<patch> is needed (an argument or $TARGET), got "${parsed.positionals.join(' ') || version}"` };
  }

  return { version, checks };
}

async function main(argv) {
  const args = readArguments(argv, process.env);
  if (args.usage !== undefined) {
    console.error(`${args.usage}\n${USAGE}`);
    return 2;
  }
  let facts;
  try {
    facts = args.facts !== undefined
      ? JSON.parse(readFileSync(args.facts, 'utf8'))
      : await gather(expectedFor(JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')), args.version), args.checks);
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
