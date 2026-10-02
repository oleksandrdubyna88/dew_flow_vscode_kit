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
 * the shims, the exec bit — is E3.S1's consumer fixture, which installs the packed tarball for real: the
 * two `pack-and-consume` tests at the end of this file.
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

/*
 * E3.S1 — the PACKED tarball, installed by npm, consumed the way an extension consumes it.
 *
 * `scripts/pack-and-consume.mjs` packs this repository (its `prepack` builds `dist/`), installs the tarball
 * into a copy of `test/consumer-fixture/`, type-checks the fixture against the INSTALLED `.d.ts`, bundles it
 * with the extensions' esbuild flags, runs the bundle under node with a `vscode` stub, and starts the
 * installed bin through npm's own shim. These two tests live in THIS file on purpose: the pack rebuilds
 * `dist/`, the dry-run pack above walks `dist/`, and tests inside one file run one after another while
 * files run side by side — in another file the two could meet halfway through a rebuild.
 */

const PACK_AND_CONSUME = path.join(ROOT, 'scripts', 'pack-and-consume.mjs');

function packAndConsume(...args: string[]): { readonly status: number | null; readonly stdout: string; readonly stderr: string } {
  const run = spawnSync(process.execPath, [PACK_AND_CONSUME, ...args], { cwd: ROOT, encoding: 'utf8', timeout: 240_000 });
  assert.equal(run.error, undefined, `pack-and-consume did not run: ${String(run.error)}`);

  return run;
}

test('pack-and-consume: the packed tarball installs, type-checks against its own .d.ts, bundles, runs under a vscode stub, and its bin starts through npm', { timeout: 300_000 }, () => {
  const run = packAndConsume();

  assert.equal(run.status, 0, `${run.stdout}\n${run.stderr}`);
  assert.match(run.stdout, /^pack-and-consume: ok +typecheck\b/m);
  assert.match(run.stdout, /^pack-and-consume: ok +run\b/m);
  assert.match(run.stdout, /^pack-and-consume: ok +bin\b/m);
  assert.match(run.stdout, /^pack-and-consume: every step passed\.$/m);
});

test('pack-and-consume goes red AT THE TYPECHECK when the fixture imports a name the package does not export (createDisplayHots)', { timeout: 300_000 }, () => {
  const run = packAndConsume('--broken-import');

  assert.equal(run.status, 1, `${run.stdout}\n${run.stderr}`);
  assert.match(run.stderr, /pack-and-consume: FAILED at step "typecheck"/);
  assert.match(run.stderr, /createDisplayHots/);
  assert.match(run.stdout, /^pack-and-consume: ok +install\b/m, 'the steps before the typecheck should have passed');
  assert.doesNotMatch(run.stdout, /^pack-and-consume: ok +(bundle|run|bin)\b/m, 'nothing after the typecheck may run');
});

test('pack-and-consume --published needs one <major>.<minor>.<patch> version, from its argument or $TARGET, and refuses anything else with exit 2 before any step', () => {
  // The online half (the registry's tarball through the same eight steps) runs in release.yml after the
  // publish and from POST_DEPLOY.md; what is held here is that a wrong target is a usage error, never a
  // step that went looking for it.
  const cases: readonly (readonly [readonly string[], string, RegExp])[] = [
    [['--published'], '', /--published needs one version <major>\.<minor>\.<patch> \(an argument or \$TARGET\), got ""/],
    [['--published'], 'v0.1.0', /got "v0\.1\.0"/],
    [['--published', '0.1'], '', /got "0\.1"/],
    [['--published', '0.1.0', '0.2.0'], '', /got "0\.1\.0 0\.2\.0"/],
    [['0.1.0'], '', /unexpected argument 0\.1\.0/],
  ];
  for (const [args, target, why] of cases) {
    const run = spawnSync(process.execPath, [PACK_AND_CONSUME, ...args], { cwd: ROOT, encoding: 'utf8', timeout: 30_000, env: { ...process.env, TARGET: target } });
    assert.equal(run.status, 2, `${args.join(' ')} (TARGET=${target}): ${run.stdout}${run.stderr}`);
    assert.match(run.stderr, why);
    assert.equal(run.stdout, '', 'no step may have started');
  }
});
