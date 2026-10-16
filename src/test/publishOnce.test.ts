import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';

/**
 * `scripts/publish-once.mjs` — the release job's publish step: `npm publish <tarball>` only when the registry
 * does not already serve that version, so a re-run after a publish that succeeded (but whose run failed after
 * it) publishes NOTHING and still reaches the verify step, which decides whether the served bytes are the
 * attested bytes. The decision is held here through `--facts`, over facts built in the shape `gather()` makes
 * (`{ expected: { name, version }, view }`, `view` being what `npm view <name>@<version> --json` answered, or
 * null for "not served"); the gathering — npm view and npm publish — runs only against a real registry, at
 * the first release (research/module_tests.md, "What it does not prove").
 *
 * The usage rows and the empty-token row run in live mode: they stop BEFORE anything is asked of a registry,
 * which is what makes them runnable here.
 */

const ROOT = path.resolve(__dirname, '..', '..');
const SCRIPT = path.join(ROOT, 'scripts', 'publish-once.mjs');
const SENTINEL = 'sentinel-never-printed';
const NAME = '@oleksandrdubyna88/vscode-webview-kit';
const MANIFEST = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')) as { version: string };

interface Ran {
  readonly code: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

/** The script, with a token that must never come back out; every row passes through here, so none can print it. */
function run(args: readonly string[], env: NodeJS.ProcessEnv = {}): Ran {
  const ran = spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8', timeout: 30_000, env: { ...process.env, NODE_AUTH_TOKEN: SENTINEL, ...env } });
  assert.equal(ran.error, undefined, `could not run: ${String(ran.error)}`);
  assert.ok(!`${ran.stdout}${ran.stderr}`.includes(SENTINEL), 'the token was printed');

  return { code: ran.status, stdout: ran.stdout, stderr: ran.stderr };
}

function inTemp<T>(body: (dir: string) => T): T {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kit-publish-once-'));
  try {
    return body(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function judge(view: unknown): Ran {
  return inTemp((dir) => {
    const file = path.join(dir, 'facts.json');
    fs.writeFileSync(file, JSON.stringify({ expected: { name: NAME, version: '0.1.1' }, view }), 'utf8');

    return run(['--facts', file]);
  });
}

const PACKED = 'oleksandrdubyna88-vscode-webview-kit-0.1.1.tgz';

test('a version the registry already serves is published NOTHING — exit 0, and the line says the verify step decides', () => {
  const { code, stdout, stderr } = judge({ name: NAME, version: '0.1.1' });

  assert.equal(code, 0, stderr);
  assert.match(stdout, /^publish-once: @oleksandrdubyna88\/vscode-webview-kit@0\.1\.1 is already served — publishing nothing; the verify step decides whether the served bytes are this run's attested bytes$/m);
  assert.match(stdout, /^publish-once: decision skip$/m);
});

test('a version the registry does not serve is published — that tarball, by name', () => {
  const { code, stdout, stderr } = judge(null);

  assert.equal(code, 0, stderr);
  assert.match(stdout, new RegExp(`^publish-once: @oleksandrdubyna88/vscode-webview-kit@0\\.1\\.1 is not served — publishing ${PACKED.replaceAll('.', '\\.')}$`, 'm'));
  assert.match(stdout, /^publish-once: decision publish$/m);
});

test('an answer naming another version is "not served" — the tarball is published', () => {
  const { code, stdout, stderr } = judge({ name: NAME, version: '0.1.0' });

  assert.equal(code, 0, stderr);
  assert.match(stdout, /^publish-once: @oleksandrdubyna88\/vscode-webview-kit@0\.1\.1 is not served — publishing /m);
  assert.match(stdout, /^publish-once: decision publish$/m);
});

test('usage exits 2 before anything is asked: no tarball, two tarballs, a path that does not exist, a file npm would not name that way', () => {
  inTemp((dir) => {
    const other = path.join(dir, 'other-name-0.1.1.tgz');
    fs.writeFileSync(other, '');
    const wrong = `is not the tarball npm pack makes for ${NAME.replaceAll('/', '\\/')}@${MANIFEST.version.replaceAll('.', '\\.')} \\(oleksandrdubyna88-vscode-webview-kit-${MANIFEST.version.replaceAll('.', '\\.')}\\.tgz\\)`;
    const cases: readonly (readonly [readonly string[], RegExp])[] = [
      [[], /one tarball is needed/],
      [['a.tgz', 'b.tgz'], /one tarball is needed, got "a\.tgz b\.tgz"/],
      [[path.join(dir, 'missing.tgz')], /does not exist/],
      [[other], new RegExp(wrong)],
    ];
    for (const [args, why] of cases) {
      const { code, stdout, stderr } = run(args);

      assert.equal(code, 2, `${args.join(' ')}: ${stdout}${stderr}`);
      assert.match(stderr, why);
      assert.equal(stdout, '', 'nothing may reach stdout before the registry is asked');
    }
  });
});

test('an empty NODE_AUTH_TOKEN exits 2 naming both token kinds, before the registry is asked', () => {
  inTemp((dir) => {
    const tarball = path.join(dir, `oleksandrdubyna88-vscode-webview-kit-${MANIFEST.version}.tgz`);
    fs.writeFileSync(tarball, '');
    const { code, stdout, stderr } = run([tarball], { NODE_AUTH_TOKEN: '' });

    assert.equal(code, 2, `${stdout}${stderr}`);
    assert.match(stderr, /NODE_AUTH_TOKEN is empty/);
    assert.match(stderr, /packages: read/);
    assert.match(stderr, /read:packages/);
    assert.equal(stdout, '', 'a registry question reached stdout before the token was checked');
  });
});
