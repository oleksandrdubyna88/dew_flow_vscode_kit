import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';

/**
 * `scripts/verify-published.mjs` — what release.yml runs after `npm publish`, and POST_DEPLOY.md items 1–3.
 * Its DECISION is held here, through `--facts`, over facts RECORDED from the registry for a real package
 * published from GitHub Actions with provenance (`@sigstore/core@3.0.0`, by the script's own `gather()`,
 * 2026-10-02 — `fixtures/verify-published-sigstore-core-3.0.0.json`), never over a statement typed from a
 * reading of the SLSA spec. Each refusal is that real record with one fact changed.
 *
 * The gathering half (npm view with retries, the attestation fetch, the throwaway install) runs only against
 * a real registry: measured once against that same package (all three checks ok in 5.9 s), and otherwise
 * at the first release — see research/module_tests.md, "What it does not prove".
 */

const ROOT = path.resolve(__dirname, '..', '..');
const SCRIPT = path.join(ROOT, 'scripts', 'verify-published.mjs');
const RECORDED = path.join(ROOT, 'src', 'test', 'fixtures', 'verify-published-sigstore-core-3.0.0.json');

interface Ran {
  readonly code: number | null;
  readonly said: string;
}

type Facts = Record<string, unknown> & { expected: Record<string, string> };

const recorded = (): Facts => JSON.parse(fs.readFileSync(RECORDED, 'utf8')) as Facts;

function run(args: readonly string[], env: NodeJS.ProcessEnv = {}): Ran {
  const ran = spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8', timeout: 30_000, env: { ...process.env, TARGET: '', ...env } });
  assert.equal(ran.error, undefined, `could not run: ${String(ran.error)}`);

  return { code: ran.status, said: `${ran.stdout}${ran.stderr}` };
}

function judge(facts: unknown, ...args: string[]): Ran {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kit-verify-'));
  try {
    const file = path.join(dir, 'facts.json');
    fs.writeFileSync(file, JSON.stringify(facts), 'utf8');
    return run(['--facts', file, ...args]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** The recorded facts with `edit` applied to a deep copy. */
function changed(edit: (facts: any) => void): Facts { // eslint-disable-line @typescript-eslint/no-explicit-any -- a JSON record edited by path
  const facts = recorded();
  edit(facts);

  return facts;
}

test('the recorded real package passes all three checks — version, provenance identity and digest, signatures', () => {
  const { code, said } = judge(recorded());

  assert.equal(code, 0, said);
  assert.match(said, /^verify-published: ok — @sigstore\/core@3\.0\.0: version, provenance, signatures$/m);
});

test('a provenance from another repository, workflow or ref is refused, naming each field', () => {
  const { code, said } = judge(changed((f) => {
    f.expected.repository = 'https://github.com/oleksandrdubyna88/dew_flow_vscode_kit';
    f.expected.ref = 'refs/tags/v3.0.0';
    f.expected.workflow = '.github/workflows/publish.yml';
  }));

  assert.equal(code, 1, said);
  assert.match(said, /workflow repository "https:\/\/github\.com\/sigstore\/sigstore-js", not "https:\/\/github\.com\/oleksandrdubyna88\/dew_flow_vscode_kit"/);
  assert.match(said, /workflow path "\.github\/workflows\/release\.yml", not "\.github\/workflows\/publish\.yml"/);
  assert.match(said, /workflow ref "refs\/heads\/main", not "refs\/tags\/v3\.0\.0"/);
});

test('a provenance about other bytes is refused: the served integrity no longer matches the statement\'s sha512', () => {
  const { code, said } = judge(changed((f) => {
    f.view.dist.integrity = `sha512-${Buffer.alloc(64, 7).toString('base64')}`;
  }));

  assert.equal(code, 1, said);
  assert.match(said, /provenance: the provenance's sha512 is not the served tarball's integrity/);
});

test('a provenance about another package or version is refused', () => {
  const { code, said } = judge(changed((f) => {
    f.statement.subject[0].name = 'pkg:npm/%40sigstore/core@3.0.1';
  }));

  assert.equal(code, 1, said);
  assert.match(said, /is about "pkg:npm\/%40sigstore\/core@3\.0\.1", not "pkg:npm\/%40sigstore\/core@3\.0\.0"/);
});

test('a version published without provenance is refused — the shape a laptop publish has', () => {
  const { code, said } = judge(changed((f) => {
    delete f.view.dist.attestations;
    f.statement = null;
  }), '--check', 'provenance');

  assert.equal(code, 1, said);
  assert.match(said, /carries no SLSA v1 provenance \(dist\.attestations\)/);
});

test('a version the registry does not serve is refused by the version check', () => {
  const { code, said } = judge(changed((f) => {
    f.view = null;
  }), '--check', 'version');

  assert.equal(code, 1, said);
  assert.match(said, /version: npm view @sigstore\/core@3\.0\.0 answered nothing/);
});

test('npm audit signatures without a verified attestation, or with a failing exit, is refused', () => {
  const unattested = judge(changed((f) => {
    f.audit.stdout = 'audited 1 package in 0s\n\n1 package has a verified registry signature\n';
  }), '--check', 'signatures');
  assert.equal(unattested.code, 1, unattested.said);
  assert.match(unattested.said, /did not report one package with a verified attestation/);

  const invalid = judge(changed((f) => {
    f.audit = { status: 1, stdout: 'audited 1 package in 0s\n\n1 package has an invalid registry signature\n' };
  }), '--check', 'signatures');
  assert.equal(invalid.code, 1, invalid.said);
  assert.match(invalid.said, /npm audit signatures exited 1/);
});

test('--check runs only the named check: a broken provenance does not fail --check version', () => {
  const facts = changed((f) => {
    f.statement = null;
  });

  assert.equal(judge(facts, '--check', 'version').code, 0);
  assert.equal(judge(facts).code, 1);
});

test('usage: no version, a v-prefixed one, two of them, or an unknown check exits 2 before anything is asked', () => {
  const cases: readonly (readonly [readonly string[], NodeJS.ProcessEnv, RegExp])[] = [
    [[], {}, /one version <major>\.<minor>\.<patch> is needed \(an argument or \$TARGET\), got ""/],
    [[], { TARGET: 'v0.1.0' }, /got "v0\.1\.0"/],
    [['0.1.0', '0.2.0'], {}, /got "0\.1\.0 0\.2\.0"/],
    [['0.1.0', '--check', 'everything'], {}, /--check is one of version, provenance, signatures or all, not "everything"/],
  ];
  for (const [args, env, why] of cases) {
    const { code, said } = run(args, env);
    assert.equal(code, 2, `${args.join(' ')}: ${said}`);
    assert.match(said, why);
  }
});

test('facts without an expected name and version are refused, not passed', () => {
  assert.equal(judge({ view: null }).code, 2);
});
