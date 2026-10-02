#!/usr/bin/env node
/**
 * pack-and-consume — the package as a consumer meets it: the PACKED tarball, installed by npm, type-checked,
 * bundled the way the extensions bundle, run, and its bin started through npm's own shim (E3.S1,
 * `todo/PLAN_extract_the_kit.md`; the family rule "verify the ARTEFACT, not the source").
 *
 *     node scripts/pack-and-consume.mjs                  # every step; exit 0
 *     node scripts/pack-and-consume.mjs --broken-import  # the teeth: the fixture misspells an import; exit 1 at "typecheck"
 *     node scripts/pack-and-consume.mjs --published [<version>]  # the same steps over the tarball npmjs SERVES (E3.S2)
 *
 * `--published` takes the version from its argument or from `$TARGET` (POST_DEPLOY.md passes it that way),
 * refuses anything but `<major>.<minor>.<patch>` with exit 2, and changes only the first step and the
 * version `install` expects: everything after it is the same check, over the published bytes.
 *
 * The steps, each named in the log and in a failure:
 *
 *   pack       `npm pack` from a repository with NO `dist/` — this script removes it first, so only the
 *              `prepack` script (`npm run build`) can put it into the tarball (epic 3 plan round, finding 1).
 *              With `--published`: `npm pack <name>@<version>` in the temporary directory, asked
 *              anonymously (`lib/npm.mjs`), which DOWNLOADS the registry's tarball and builds nothing.
 *   contents   the tarball, read here byte by byte (gunzip + tar headers, not npm's summary): it carries
 *              `dist/index.js`, `dist/index.d.ts` and every `bin` target, and nothing the manifest's `files`
 *              and npm's own three (`package.json`, `README.md`, `LICENSE`) do not name; `dist/` holds only
 *              `.js` and `.d.ts`.
 *   fixture    `test/consumer-fixture/` copied to a temporary directory, the tarball beside it as `../kit.tgz`
 *              — the `file:` dependency its `package.json` names. `--broken-import` rewrites
 *              `createDisplayHost` to `createDisplayHots` there.
 *   install    `npm install --offline` in the copy. The kit has no runtime dependencies and the fixture
 *              has no other, so nothing is downloaded; the installed version must be this manifest's.
 *   typecheck  `tsc -p` over the fixture against the INSTALLED `.d.ts` — `node16` resolution through the
 *              `exports` map, `skipLibCheck: false` — with the TypeScript of this repository's devDependencies.
 *   bundle     esbuild from this repository's devDependencies with the extensions' flags (`bundle`,
 *              `external: vscode`, `format: cjs`, `platform: node`); every input must come from the copy
 *              (its sources and its installed `node_modules`), never from this repository.
 *   run        `node run.mjs dist/extension.js` in the copy: the bundle under a `vscode` stub — a help page
 *              under a CSP nonce, a press validated and written through the stub configuration, refused
 *              messages writing nothing, the escapers, every listener unhooked.
 *   bin        the installed `vscode-webview-kit-help-digests` through `npm exec --no` (npm's shim, on every
 *              OS) over the fixture's bundled catalog: exit 0, "every translation was made from the current
 *              English". On POSIX the `.bin` link is also executed directly, which needs the executable bit
 *              and the shebang.
 *
 * Node built-ins only, plus `typescript` and `esbuild` resolved from this repository's own `node_modules`.
 * Every child is `node <script> <args>` — no shell, no command string. npm's `npm_*` variables are removed
 * from every child's environment, so a run started by `npm test` or `npm publish --dry-run` cannot hand its
 * own prefix or dry-run to the npm this script starts. The temporary directory is removed at the end, pass
 * or fail.
 *
 * Exit: 0 every step passed; 1 a step failed (stderr: `pack-and-consume: FAILED at step "<name>": …`);
 * 2 usage.
 */
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { gunzipSync } from 'node:zlib';

import { anonymousEnv, childEnv, npmCli as findNpmCli } from './lib/npm.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURE = join(ROOT, 'test', 'consumer-fixture');
const MANIFEST = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const CHILD_TIMEOUT_MS = 180_000;
/** What npm packs whatever `files` says. */
const NPM_ALWAYS = ['package.json', 'README.md', 'LICENSE'];
const REQUIRED = ['dist/index.js', 'dist/index.d.ts'];
const FRESH = 'help-digests: every translation was made from the current English.';
const MISSPELT = { from: 'createDisplayHost', to: 'createDisplayHots' };

/** A step's failure: its message is what the log prints after the step's name. */
class StepFailure extends Error {}

const fail = (message) => {
  throw new StepFailure(message);
};

const repoRequire = createRequire(join(ROOT, 'package.json'));

/** npm's own CLI script (`lib/npm.mjs`), its absence a step failure. */
function npmCli() {
  try {
    return findNpmCli();
  } catch (error) {
    return fail(error.message);
  }
}

/** The last lines of a child's output, for a failure message. */
function tail(text, lines = 40) {
  return (text ?? '').trimEnd().split(/\r?\n/).slice(-lines).join('\n');
}

/** `node <args>` in `cwd`; refuses a spawn error, a timeout or a non-zero exit, naming `what`. */
function node(args, cwd, what, env = childEnv()) {
  const result = spawnSync(process.execPath, args, { cwd, env, encoding: 'utf8', timeout: CHILD_TIMEOUT_MS });
  if (result.error !== undefined) {
    fail(`${what} did not run: ${result.error.message}`);
  }
  if (result.status !== 0) {
    fail(`${what} exited ${result.status ?? result.signal}\n${tail(result.stdout)}\n${tail(result.stderr)}`.trimEnd());
  }

  return result;
}

const npm = (args, cwd, what, env = childEnv()) => node([npmCli(), ...args], cwd, what, env);

/** The paths in a `.tgz`, read from the ustar headers themselves; `package/` is stripped. */
function tarballPaths(file) {
  const tar = gunzipSync(readFileSync(file));
  const paths = [];
  for (let offset = 0; offset + 512 <= tar.length;) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) {
      break;
    }
    const field = (start, length) => header.subarray(start, start + length).toString('utf8').replace(/\0.*$/s, '');
    const name = [field(345, 155), field(0, 100)].filter(Boolean).join('/');
    const size = Number.parseInt(field(124, 12).trim() || '0', 8);
    if (field(156, 1) === '0' || field(156, 1) === '') {
      paths.push(name.replace(/^package\//, ''));
    }
    offset += 512 + Math.ceil(size / 512) * 512;
  }

  return paths.sort();
}

/** Whether the manifest's `files` (a directory or a file) or npm's own three admit `path`. */
function admitted(path) {
  return NPM_ALWAYS.includes(path) || MANIFEST.files.some((entry) => path === entry || path.startsWith(`${entry}/`));
}

/** `npm pack` here, from a repository with no dist/ — or, with --published, the registry's tarball. */
function packInto(ctx, destination) {
  if (ctx.published) {
    npm(['pack', `${MANIFEST.name}@${ctx.version}`, '--pack-destination', destination], ctx.temp, 'npm pack of the published version', anonymousEnv(ctx.temp));
    return;
  }
  // No dist/: only prepack can put one into the tarball.
  rmSync(join(ROOT, 'dist'), { recursive: true, force: true });
  npm(['pack', '--pack-destination', destination], ROOT, 'npm pack');
}

function packStep(ctx) {
  const destination = join(ctx.temp, 'pack');
  mkdirSync(destination);
  packInto(ctx, destination);
  const tarballs = readdirSync(destination).filter((file) => file.endsWith('.tgz'));
  if (tarballs.length !== 1) {
    fail(`npm pack left ${tarballs.length} tarball(s) in ${destination}: ${tarballs.join(', ')}`);
  }
  ctx.tarball = join(ctx.temp, 'kit.tgz');
  renameSync(join(destination, tarballs[0]), ctx.tarball);

  return ctx.published ? `${tarballs[0]} from the registry` : tarballs[0];
}

function contentsStep(ctx) {
  const paths = tarballPaths(ctx.tarball);
  const required = [...REQUIRED, ...Object.values(MANIFEST.bin ?? {})];
  const missing = required.filter((path) => !paths.includes(path));
  if (missing.length > 0) {
    fail(`the tarball lacks ${missing.join(', ')} — did prepack build dist/? It carries: ${paths.join(', ')}`);
  }
  const unexpected = paths.filter((path) => !admitted(path));
  if (unexpected.length > 0) {
    fail(`the tarball carries files nobody meant to ship: ${unexpected.join(', ')}`);
  }
  const strayDist = paths.filter((path) => path.startsWith('dist/') && !path.endsWith('.js') && !path.endsWith('.d.ts'));
  if (strayDist.length > 0) {
    fail(`dist/ in the tarball holds more than .js and .d.ts: ${strayDist.join(', ')}`);
  }

  return `${paths.length} files, ${paths.filter((path) => path.startsWith('dist/')).length} under dist/`;
}

function fixtureStep(ctx, brokenImport) {
  ctx.consumer = join(ctx.temp, 'consumer');
  cpSync(FIXTURE, ctx.consumer, { recursive: true, filter: (source) => !/[\\/](node_modules|dist)$/.test(source) });
  if (!brokenImport) {
    return 'copied';
  }
  const file = join(ctx.consumer, 'src', 'extension.ts');
  const text = readFileSync(file, 'utf8');
  const importLine = text.split('\n').find((line) => line.trim() === `${MISSPELT.from},`);
  if (importLine === undefined) {
    fail(`--broken-import: the fixture's import list has no "${MISSPELT.from}," line to misspell`);
  }
  writeFileSync(file, text.replaceAll(MISSPELT.from, MISSPELT.to));

  return `variant: ${MISSPELT.from} imported as ${MISSPELT.to}`;
}

function installStep(ctx) {
  npm(['install', '--offline', '--no-audit', '--no-fund', '--no-package-lock'], ctx.consumer, 'npm install of the tarball');
  const installed = join(ctx.consumer, 'node_modules', ...MANIFEST.name.split('/'));
  const version = JSON.parse(readFileSync(join(installed, 'package.json'), 'utf8')).version;
  if (version !== ctx.version) {
    fail(`installed ${MANIFEST.name}@${version}, expected ${ctx.version}`);
  }

  return `${MANIFEST.name}@${version}`;
}

function typecheckStep(ctx) {
  const tsc = join(dirname(repoRequire.resolve('typescript/package.json')), 'bin', 'tsc');
  node([tsc, '-p', 'tsconfig.json'], ctx.consumer, 'tsc over the fixture');

  return `typescript ${repoRequire('typescript/package.json').version}`;
}

/** Every esbuild input outside the consumer copy — there must be none. */
function foreignInputs(consumer, metafile) {
  return Object.keys(metafile.inputs).filter((input) => {
    const absolute = resolve(consumer, input);
    const inside = relative(consumer, absolute);
    return isAbsolute(inside) || inside === '..' || inside.startsWith(`..${sep}`);
  });
}

async function bundleStep(ctx) {
  const esbuild = repoRequire('esbuild');
  let result;
  try {
    result = await esbuild.build({
      absWorkingDir: ctx.consumer,
      entryPoints: { extension: 'src/extension.ts', helpCatalog: 'src/helpCatalog.ts' },
      outdir: 'dist',
      bundle: true,
      external: ['vscode'],
      format: 'cjs',
      platform: 'node',
      metafile: true,
      logLevel: 'silent',
    });
  } catch (error) {
    fail(`esbuild refused the fixture: ${error.message}`);
  }
  const foreign = foreignInputs(ctx.consumer, result.metafile);
  if (foreign.length > 0) {
    fail(`the bundle read files outside the consumer copy: ${foreign.join(', ')}`);
  }

  return `esbuild ${esbuild.version}, ${Object.keys(result.metafile.inputs).length} inputs`;
}

function runStep(ctx) {
  const result = node(['run.mjs', join('dist', 'extension.js')], ctx.consumer, 'the bundle under the vscode stub');

  return result.stdout.trim().replace(/^consumer-fixture: ok — /, '');
}

function binStep(ctx) {
  const name = Object.keys(MANIFEST.bin)[0];
  const catalog = join('dist', 'helpCatalog.js');
  const viaNpm = npm(['exec', '--no', '--offline', '--', name, catalog], ctx.consumer, `npm exec ${name}`);
  if (!viaNpm.stdout.includes(FRESH)) {
    fail(`npm exec ${name} printed something else:\n${tail(viaNpm.stdout)}`);
  }
  if (process.platform === 'win32') {
    return `${name} through npm's .cmd shim`;
  }
  const link = join(ctx.consumer, 'node_modules', '.bin', name);
  const direct = spawnSync(link, [catalog], { cwd: ctx.consumer, env: childEnv(), encoding: 'utf8', timeout: CHILD_TIMEOUT_MS });
  if (direct.error !== undefined || direct.status !== 0 || !direct.stdout.includes(FRESH)) {
    fail(`${link} did not run as an executable (exec bit, shebang): ${direct.error?.message ?? `exit ${direct.status}`}\n${tail(direct.stderr)}`);
  }

  return `${name} through npm exec and as an executable .bin link`;
}

function steps(brokenImport) {
  return [
    { name: 'pack', run: packStep },
    { name: 'contents', run: contentsStep },
    { name: 'fixture', run: (ctx) => fixtureStep(ctx, brokenImport) },
    { name: 'install', run: installStep },
    { name: 'typecheck', run: typecheckStep },
    { name: 'bundle', run: bundleStep },
    { name: 'run', run: runStep },
    { name: 'bin', run: binStep },
  ];
}

const USAGE = 'usage: node scripts/pack-and-consume.mjs [--broken-import] [--published [<version>]]  (the version, else $TARGET)';
const VERSION_SHAPE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

/** The flags and, with --published, the version to download — or `{ usage }` naming what is wrong. */
function readArguments(argv, env) {
  let parsed;
  try {
    parsed = parseArgs({ args: argv, allowPositionals: true, options: { 'broken-import': { type: 'boolean', default: false }, published: { type: 'boolean', default: false } } });
  } catch (error) {
    return { usage: error.message };
  }
  const { 'broken-import': brokenImport, published } = parsed.values;
  if (!published) {
    return parsed.positionals.length === 0 ? { brokenImport, published, version: MANIFEST.version } : { usage: `unexpected argument ${parsed.positionals[0]}` };
  }
  const version = parsed.positionals[0] ?? env.TARGET ?? '';
  if (parsed.positionals.length > 1 || !VERSION_SHAPE.test(version)) {
    return { usage: `--published needs one version <major>.<minor>.<patch> (an argument or $TARGET), got "${parsed.positionals.join(' ') || version}"` };
  }

  return { brokenImport, published, version };
}

/** Run the steps in order; the first failure stops the run. Answers the exit code. */
async function main() {
  const args = readArguments(process.argv.slice(2), process.env);
  if (args.usage !== undefined) {
    process.stderr.write(`${args.usage}\n${USAGE}\n`);
    return 2;
  }
  const { brokenImport } = args;
  const ctx = { temp: mkdtempSync(join(tmpdir(), 'kit-pack-and-consume-')), published: args.published, version: args.version };
  const started = Date.now();
  try {
    for (const { name, run } of steps(brokenImport)) {
      const begun = Date.now();
      try {
        const detail = await run(ctx);
        process.stdout.write(`pack-and-consume: ok   ${name.padEnd(9)} ${String(Date.now() - begun).padStart(6)} ms  ${detail}\n`);
      } catch (error) {
        const message = error instanceof StepFailure ? error.message : (error?.stack ?? String(error));
        process.stderr.write(`pack-and-consume: FAILED at step "${name}": ${message}\n`);
        return 1;
      }
    }
    process.stdout.write(`pack-and-consume: total ${Date.now() - started} ms\npack-and-consume: every step passed.\n`);
    return 0;
  } finally {
    rmSync(ctx.temp, { recursive: true, force: true });
  }
}

process.exitCode = await main();
