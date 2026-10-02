import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';

/**
 * `help-digests` reaches consumers (coordinator's decision, E2.S3): the package ships it as a `bin`, so a
 * consumer runs `npx vscode-webview-kit-help-digests <its catalog module>` after a re-translation and
 * gets the `from` lines to paste. Three things are pinned: the manifest says so (`bin`, `files`), a pack
 * really carries the script, and the script RUNS from an installed package's layout against that
 * package's own `dist/` with no `--kit` — which is the resolution a consumer relies on.
 *
 * The installed layout is built by hand from this build's `out/` (minus the tests), because `dist/` is
 * what `npm run build` makes and the suite runs on `out/`; what npm's own installer does with the bin —
 * the shims, the exec bit — is E3.S1's consumer fixture, which installs the packed tarball for real.
 */

const ROOT = path.resolve(__dirname, '..', '..');
const OUT = path.resolve(__dirname, '..');
const BIN_NAME = 'vscode-webview-kit-help-digests';
const SCRIPT = 'scripts/help-digests.mjs';
const FIXTURE = path.join(OUT, 'test', 'fixtures', 'helpDigestsCatalog.js');
/** What a pack may carry besides `dist/`. */
const ALWAYS_PACKED = ['package.json', 'README.md', 'LICENSE', SCRIPT];

interface Manifest {
  readonly name: string;
  readonly files: readonly string[];
  readonly bin?: Readonly<Record<string, string>>;
}

const manifest = (): Manifest => JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')) as Manifest;

/** `npm pack --dry-run --json` from the repository root: the paths a publish would carry. */
function packedPaths(): string[] {
  const args = ['pack', '--dry-run', '--json', '--ignore-scripts'];
  const npmCli = process.env['npm_execpath'];
  const result = npmCli !== undefined
    ? spawnSync(process.execPath, [npmCli, ...args], { cwd: ROOT, encoding: 'utf8', timeout: 60_000 })
    : spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', args, { cwd: ROOT, encoding: 'utf8', timeout: 60_000, shell: process.platform === 'win32' });
  assert.equal(result.error, undefined, `npm did not run: ${String(result.error)}`);
  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout) as { files: { path: string }[] }[];

  return parsed[0]?.files.map((file) => file.path) ?? [];
}

test('the manifest ships the bin: named vscode-webview-kit-help-digests, pointing at the script, with dist and the script in files', () => {
  const { bin, files } = manifest();

  assert.deepEqual(bin, { [BIN_NAME]: SCRIPT });
  assert.ok(files.includes('dist'), 'dist is not in files');
  assert.ok(files.includes(SCRIPT), `${SCRIPT} is not in files`);
});

test('npm pack carries the bin script, the manifest, README and LICENSE, and otherwise only dist/', { timeout: 90_000 }, () => {
  const paths = packedPaths();

  assert.ok(paths.includes(SCRIPT), `the pack does not carry ${SCRIPT}; it carries: ${paths.join(', ')}`);
  const stray = paths.filter((p) => !ALWAYS_PACKED.includes(p) && !p.startsWith('dist/'));
  assert.deepEqual(stray, [], 'files a publish would carry that nobody meant to ship');
});

/** This build, laid out as npm installs the package: `node_modules/<name>/{package.json, scripts/, dist/}`. */
function installedLayout(): { readonly root: string; readonly script: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kit-installed-'));
  const pkg = path.join(root, 'node_modules', ...manifest().name.split('/'));
  fs.mkdirSync(path.join(pkg, 'scripts'), { recursive: true });
  fs.copyFileSync(path.join(ROOT, 'package.json'), path.join(pkg, 'package.json'));
  fs.copyFileSync(path.join(ROOT, SCRIPT), path.join(pkg, SCRIPT));
  const tests = path.join(OUT, 'test');
  fs.cpSync(OUT, path.join(pkg, 'dist'), { recursive: true, filter: (source) => source !== tests && !source.startsWith(`${tests}${path.sep}`) });

  return { root, script: path.join(pkg, SCRIPT) };
}

test('the bin runs from an installed layout against the package\'s own dist, with no --kit', { timeout: 30_000 }, () => {
  const { root, script } = installedLayout();
  try {
    assert.equal(fs.existsSync(path.join(path.dirname(script), '..', 'dist', 'index.js')), true, 'the layout has no dist/index.js');

    const stale = spawnSync(process.execPath, [script, FIXTURE], { encoding: 'utf8', timeout: 10_000, cwd: root });
    assert.equal(stale.stderr, '');
    assert.match(stale.stdout, /^help-digests: 3 translation\(s\) were not made from the current English\./);
    assert.equal(stale.status, 1);

    const fresh = spawnSync(process.execPath, [script, FIXTURE, '--export', 'freshCatalog'], { encoding: 'utf8', timeout: 10_000, cwd: root });
    assert.equal(fresh.stdout, 'help-digests: every translation was made from the current English.\n');
    assert.equal(fresh.status, 0);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('the script starts with a node shebang, as a bin must', () => {
  const text = fs.readFileSync(path.join(ROOT, SCRIPT), 'utf8');

  assert.ok(text.startsWith('#!/usr/bin/env node\n'));
});
