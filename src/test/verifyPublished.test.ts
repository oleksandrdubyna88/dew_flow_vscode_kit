import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';

/**
 * `scripts/verify-published.mjs` — what release.yml runs after the publish, and POST_DEPLOY.md items 1–4.
 * Its DECISION is held here, through `--facts`, over facts RECORDED for a real artefact that a real GitHub
 * Actions workflow attested (`cli/cli` v2.97.0, `gh_2.97.0_linux_armv6.tar.gz`, `deployment.yml@refs/heads/trunk`,
 * the output of `gh attestation verify --format json` with exit 0, 2026-10-16 —
 * `fixtures/verify-published-github-packages.json`, whose `$recorded` says exactly which parts are real and
 * which are built in the documented shape), never over a statement typed from a reading of the SLSA spec.
 * So "passes" means the decision accepts a REAL verified record, and each refusal is that record with one
 * fact changed.
 *
 * The gathering half (npm view with retries, `npm pack <name>@<version>` of the served tarball, `gh
 * attestation verify`, `gh api`) runs only against a real GitHub Packages package, which does not exist
 * before the first release — see research/module_tests.md, "What it does not prove".
 */

const ROOT = path.resolve(__dirname, '..', '..');
const SCRIPT = path.join(ROOT, 'scripts', 'verify-published.mjs');
const RECORDED = path.join(ROOT, 'src', 'test', 'fixtures', 'verify-published-github-packages.json');
const SENTINEL = 'sentinel-never-printed';
const IDENTITY = 'https://github.com/cli/cli/.github/workflows/deployment.yml@refs/heads/trunk';

interface Ran {
  readonly code: number | null;
  readonly said: string;
}

type Facts = Record<string, unknown> & { expected: Record<string, string> };

const recorded = (): Facts => JSON.parse(fs.readFileSync(RECORDED, 'utf8')) as Facts;
const escaped = (text: string): string => text.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');

/** The script with a token that must never come back out — every row passes through here, so none can print it. */
function run(args: readonly string[], env: NodeJS.ProcessEnv = {}, timeout = 30_000): Ran {
  const ran = spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8', timeout, env: { ...process.env, TARGET: '', NODE_AUTH_TOKEN: SENTINEL, ...env } });
  assert.ok(ran.error === undefined || (ran.error as NodeJS.ErrnoException).code === 'ETIMEDOUT', `could not run: ${String(ran.error)}`);
  const said = `${ran.stdout}${ran.stderr}`;
  assert.ok(!said.includes(SENTINEL), 'the token was printed');

  return { code: ran.status, said };
}

function inTemp<T>(body: (dir: string) => T): T {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kit-verify-'));
  try {
    return body(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function judge(facts: unknown, ...args: string[]): Ran {
  return inTemp((dir) => {
    const file = path.join(dir, 'facts.json');
    fs.writeFileSync(file, JSON.stringify(facts), 'utf8');

    return run(['--facts', file, ...args]);
  });
}

/** The recorded facts with `edit` applied to a deep copy. */
function changed(edit: (facts: any) => void): Facts { // eslint-disable-line @typescript-eslint/no-explicit-any -- a JSON record edited by path
  const facts = recorded();
  edit(facts);

  return facts;
}

/** The certificate of the one recorded entry. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- a JSON record edited by path
const certificateOf = (facts: any): any => facts.attestation.entries[0].verificationResult.signature.certificate;

test('the recorded real artefact passes all four checks — version, integrity, attestation identity, visibility', () => {
  const { code, said } = judge(recorded());

  assert.equal(code, 0, said);
  assert.match(said, /^verify-published: ok — gh@2\.97\.0: version, integrity, attestation, visibility$/m);
});

test('served bytes that are not the packument\'s dist.integrity are refused', () => {
  const { code, said } = judge(changed((f) => {
    f.view.dist.integrity = `sha512-${Buffer.alloc(64, 7).toString('base64')}`;
  }), '--check', 'integrity');

  assert.equal(code, 1, said);
  assert.match(said, /integrity: the served tarball's sha512 is not dist\.integrity/);
});

test('the attested tarball that is not the served tarball is refused — attesting one archive and publishing another', () => {
  const { code, said } = judge(changed((f) => {
    f.local.sha512 = `sha512-${Buffer.alloc(64, 9).toString('base64')}`;
  }), '--check', 'integrity');

  assert.equal(code, 1, said);
  assert.match(said, /integrity: the attested tarball gh_2\.97\.0_linux_armv6\.tar\.gz is not the served tarball — sha512 differ/);
});

test('without a --tarball (no local file) the integrity check still binds served = packument, and passes', () => {
  const { code, said } = judge(changed((f) => {
    f.local = null;
  }), '--check', 'integrity');

  assert.equal(code, 0, said);
});

test('a packument with no sha512 dist.integrity is refused', () => {
  const { code, said } = judge(changed((f) => {
    delete f.view.dist.integrity;
  }), '--check', 'integrity');

  assert.equal(code, 1, said);
  assert.match(said, /integrity: the packument carries no sha512 dist\.integrity/);
});

test('a gh attestation verify that exits non-zero is refused, with gh\'s own words', () => {
  const { code, said } = judge(changed((f) => {
    f.attestation.status = 1;
    f.attestation.stderr = 'Error: no attestations found';
  }), '--check', 'attestation');

  assert.equal(code, 1, said);
  assert.match(said, /attestation: gh attestation verify exited 1/);
  assert.match(said, /no attestations found/);
});

test('a certificate of another repository or workflow is refused, naming the identity wanted and the one seen', () => {
  const wanted = 'https://github.com/oleksandrdubyna88/dew_flow_vscode_kit/.github/workflows/release.yml@refs/heads/trunk';
  const { code, said } = judge(changed((f) => {
    f.expected.identity = wanted;
  }), '--check', 'attestation');

  assert.equal(code, 1, said);
  assert.match(said, new RegExp(`no entry's certificate subjectAlternativeName is "${escaped(wanted)}" \\(seen: ${escaped(IDENTITY)}\\)`));
});

test('a certificate of another ref is refused — the identity is the SAN, the ref is read back separately', () => {
  const { code, said } = judge(changed((f) => {
    f.expected.ref = 'refs/tags/v2.97.0';
  }), '--check', 'attestation');

  assert.equal(code, 1, said);
  assert.match(said, /no entry's certificate sourceRepositoryRef is "refs\/tags\/v2\.97\.0" \(seen: refs\/heads\/trunk\)/);
});

test('a certificate of a self-hosted runner is refused', () => {
  const { code, said } = judge(changed((f) => {
    certificateOf(f).runnerEnvironment = 'self-hosted';
  }), '--check', 'attestation');

  assert.equal(code, 1, said);
  assert.match(said, /no entry's certificate runnerEnvironment is "github-hosted" \(seen: self-hosted\)/);
});

test('a statement that is not SLSA v1 provenance is refused', () => {
  const { code, said } = judge(changed((f) => {
    f.attestation.entries[0].verificationResult.statement.predicateType = 'https://slsa.dev/provenance/v0.2';
  }), '--check', 'attestation');

  assert.equal(code, 1, said);
  assert.match(said, /no entry's statement predicateType is "https:\/\/slsa\.dev\/provenance\/v1"/);
});

test('a subject whose sha256 is not the served file\'s is refused — an attestation of other bytes', () => {
  const none = '00'.repeat(32);
  const { code, said } = judge(changed((f) => {
    f.served.sha256 = none;
    f.local.sha256 = none;
  }), '--check', 'attestation');

  assert.equal(code, 1, said);
  assert.match(said, new RegExp(`no entry's statement subject carries sha256 ${none} — the served tarball's`));
});

test('an attestation answer with no entry at all is refused', () => {
  const { code, said } = judge(changed((f) => {
    f.attestation.entries = [];
  }), '--check', 'attestation');

  assert.equal(code, 1, said);
  assert.match(said, /attestation: gh answered no attestation entry/);
});

test('the conditions must hold on ONE entry — each met by a different entry is still refused', () => {
  const { code, said } = judge(changed((f) => {
    const [first] = f.attestation.entries;
    const second = structuredClone(first);
    first.verificationResult.signature.certificate.runnerEnvironment = 'self-hosted';
    second.verificationResult.statement.predicateType = 'https://slsa.dev/provenance/v0.2';
    f.attestation.entries = [first, second];
  }), '--check', 'attestation');

  assert.equal(code, 1, said);
  assert.match(said, /attestation: no single entry meets every condition/);
});

test('a package that is not public is refused, and the message names the owner\'s click', () => {
  const { code, said } = judge(changed((f) => {
    f.visibility.answer.visibility = 'private';
  }), '--check', 'visibility');

  assert.equal(code, 1, said);
  assert.match(said, /visibility: the package is "private", not public — the owner's click: https:\/\/github\.com\/cli\/cli\/pkgs\/npm\/gh → Package settings → Danger Zone → Change visibility → Public \(irreversible\)/);
});

test('a version the registry does not serve is refused by the version check', () => {
  const { code, said } = judge(changed((f) => {
    f.view = null;
  }), '--check', 'version');

  assert.equal(code, 1, said);
  assert.match(said, /version: npm view gh@2\.97\.0 answered nothing — that version is not served/);
});

test('--check runs only what it names, and may be repeated', () => {
  const facts = changed((f) => {
    f.attestation.status = 1;
  });

  assert.equal(judge(facts, '--check', 'version').code, 0);
  assert.equal(judge(facts, '--check', 'version', '--check', 'integrity').code, 0);
  assert.equal(judge(facts, '--check', 'version', '--check', 'attestation').code, 1);
  assert.equal(judge(facts).code, 1);
});

test('usage exits 2 before anything is asked: no version, a v-prefixed one, two of them, an unknown check, a --tarball that is not there, --facts with --tarball', () => {
  inTemp((dir) => {
    const missing = path.join(dir, 'missing.tgz');
    const facts = path.join(dir, 'facts.json');
    fs.writeFileSync(facts, JSON.stringify(recorded()), 'utf8');
    const cases: readonly (readonly [readonly string[], NodeJS.ProcessEnv, RegExp])[] = [
      [[], {}, /one version <major>\.<minor>\.<patch> is needed \(an argument or \$TARGET\), got ""/],
      [[], { TARGET: 'v0.1.1' }, /got "v0\.1\.1"/],
      [['0.1.1', '0.2.0'], {}, /got "0\.1\.1 0\.2\.0"/],
      [['0.1.1', '--check', 'everything'], {}, /--check is one of version, integrity, attestation, visibility, not "everything"/],
      [['0.1.1', '--tarball', missing], {}, new RegExp(`--tarball ${escaped(missing)} does not exist`)],
      [['--facts', facts, '--tarball', missing], {}, /--facts takes no --tarball/],
    ];
    for (const [args, env, why] of cases) {
      const { code, said } = run(args, env);

      assert.equal(code, 2, `${args.join(' ')}: ${said}`);
      assert.match(said, why);
    }
  });
});

test('an empty NODE_AUTH_TOKEN exits 2 naming both token kinds, before anything is asked', () => {
  // A 5 s budget: a script that skips the token check goes to the registry and retries for minutes.
  const { code, said } = run(['0.1.1', '--check', 'version'], { NODE_AUTH_TOKEN: '' }, 5_000);

  assert.equal(code, 2, said);
  assert.match(said, /could not gather what to check: NODE_AUTH_TOKEN is empty/);
  assert.match(said, /packages: read/);
  assert.match(said, /read:packages/);
  assert.doesNotMatch(said, /not served yet/, 'a registry question was asked before the token was checked');
});

test('facts without an expected name and version are refused, not passed', () => {
  assert.equal(judge({ view: null }).code, 2);
});
