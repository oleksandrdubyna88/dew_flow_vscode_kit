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
const LAYOUT_BIN_NAME = 'vscode-webview-kit-layout-check';
const LAYOUT_SCRIPT = 'scripts/layout/check.mjs';
/** What the layout bin needs at run time, besides its own scripts (`todo/PLAN_layout_check_bin.md` §3): built by `scripts/build-layout.mjs`. */
const LAYOUT_DIST = ['dist/layout/probe.js', 'dist/layout/vscode-themes.css'];
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

test('the manifest ships the bins: help-digests and the layout check, each pointing at its script, with dist and both scripts in files', () => {
  const { bin, files } = manifest();

  assert.deepEqual(bin, { [BIN_NAME]: SCRIPT, [LAYOUT_BIN_NAME]: LAYOUT_SCRIPT });
  assert.ok(files.includes('dist'), 'dist is not in files');
  assert.ok(files.includes(SCRIPT), `${SCRIPT} is not in files`);
  assert.ok(files.includes('scripts/layout'), 'scripts/layout is not in files');
});

test('npm pack carries the bin scripts, the manifest, README and LICENSE, and otherwise only dist/ and scripts/layout/', { timeout: 90_000 }, () => {
  // The pack lists what is on disk; dist/layout is made by the build, which `npm test` does not run - the same way the stylesheet test below makes its own.
  const built = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'build-layout.mjs')], { cwd: ROOT, encoding: 'utf8', timeout: 60_000 });
  assert.equal(built.status, 0, `${built.stdout}${built.stderr}`);
  const paths = packedPaths();

  assert.ok(paths.includes(SCRIPT), `the pack does not carry ${SCRIPT}; it carries: ${paths.join(', ')}`);
  for (const needed of [LAYOUT_SCRIPT, ...LAYOUT_DIST, ...layoutModules()]) {
    assert.ok(paths.includes(needed), `the pack does not carry ${needed}; it carries: ${paths.join(', ')}`);
  }
  const stray = paths.filter((p) => !ALWAYS_PACKED.includes(p) && !p.startsWith('dist/') && !p.startsWith('scripts/layout/'));
  assert.deepEqual(stray, [], 'files a publish would carry that nobody meant to ship');
});

/** Every `scripts/layout/*.mjs`, as the pack names it. */
function layoutModules(): string[] {
  return fs.readdirSync(path.join(ROOT, 'scripts', 'layout')).filter((name) => name.endsWith('.mjs')).map((name) => `scripts/layout/${name}`);
}

test('the shipped layout core has no dependency: every import is a node: built-in or a sibling file', () => {
  const imports = layoutModules().flatMap((file) => {
    const text = fs.readFileSync(path.join(ROOT, file), 'utf8');

    return [...text.matchAll(/\bfrom\s+['"]([^'"]+)['"]|\bimport\(\s*['"]([^'"]+)['"]/g)].map((match) => ({ file, from: match[1] ?? match[2] ?? '' }));
  });

  assert.ok(imports.length > 10, `the scan found ${imports.length} imports - the pattern is wrong`);
  assert.deepEqual(imports.filter(({ from }) => !from.startsWith('node:') && !from.startsWith('./')), []);
});

test('the layout bin starts with a node shebang, as a bin must', () => {
  assert.ok(fs.readFileSync(path.join(ROOT, LAYOUT_SCRIPT), 'utf8').startsWith('#!/usr/bin/env node\n'));
});

// ---- the components entry and its stylesheet (research/PLAN_kit_components_storybook.md §4.2) -------------------------

interface ExportsManifest {
  readonly exports: Readonly<Record<string, unknown>>;
  readonly sideEffects: unknown;
  readonly dependencies?: unknown;
}

const exportsManifest = (): ExportsManifest => JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')) as ExportsManifest;

test('the manifest exports ./components (types first) and ./components.css, and declares the stylesheet a side effect', () => {
  const { exports, sideEffects } = exportsManifest();
  assert.deepEqual(exports['./components'], { types: './dist/components/index.d.ts', require: './dist/components/index.js', default: './dist/components/index.js' });
  assert.equal(exports['./components.css'], './dist/components/components.css');
  // A stylesheet IS a side effect. esbuild 0.28 keeps a bare CSS import even under sideEffects: false (measured, K1);
  // bundlers that honour the field for CSS (webpack, Rollup) would drop it, so the manifest says what is true.
  assert.deepEqual(sideEffects, ['*.css']);
});

test('the package still has no runtime dependency', () => {
  assert.equal(exportsManifest().dependencies, undefined);
});

test('the build copies every exported stylesheet next to its module, from src/', () => {
  const run = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'copy-css.mjs')], { cwd: ROOT, encoding: 'utf8', timeout: 30_000 });
  assert.equal(run.status, 0, run.stderr);
  assert.equal(fs.readFileSync(path.join(ROOT, 'dist', 'components', 'components.css'), 'utf8'), fs.readFileSync(path.join(ROOT, 'src', 'components', 'components.css'), 'utf8'));
});

test('nothing of the Storybook, the stories or the gallery is in what a publish carries', { timeout: 90_000 }, () => {
  const shipped = packedPaths().filter((p) => /(^|\/)(\.storybook|stories|storybook-static|gallery)(\/|$)|\.stories\.|jsdom|axe/.test(p));

  assert.deepEqual(shipped, []);
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

test('pack-and-consume --published with an empty NODE_AUTH_TOKEN exits 2 naming both token kinds, before any step', () => {
  // GitHub Packages serves nothing without a token, so a run that cannot have one stops here and says what to
  // set — not at an "npm pack" step that fails with a 401 nobody can read.
  const run = spawnSync(process.execPath, [PACK_AND_CONSUME, '--published', '0.1.1'], { cwd: ROOT, encoding: 'utf8', timeout: 30_000, env: { ...process.env, TARGET: '', NODE_AUTH_TOKEN: '' } });

  assert.equal(run.status, 2, `${run.stdout}${run.stderr}`);
  assert.match(run.stderr, /NODE_AUTH_TOKEN is empty/);
  assert.match(run.stderr, /packages: read/);
  assert.match(run.stderr, /read:packages/);
  assert.doesNotMatch(run.stdout, /pack-and-consume: ok/, 'no step may have run');
  assert.equal(run.stdout, '', 'nothing may be on stdout');
});
