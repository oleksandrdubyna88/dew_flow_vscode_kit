/**
 * The shared half of the coai recorders: take ConnectOtherAIs source files at a ref, compile them with this
 * repository's own TypeScript into a temporary directory, and hand back a `require` for the result.
 *
 * <p>Used by `record-coai-display.mjs`, `record-coai-help.mjs` and `record-coai-help-page.mjs`. All three
 * record what coai's REAL modules compute, so the kit's tests compare against values the reference
 * implementation produced rather than literals somebody retyped (the family's testing rule).</p>
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * This repository's `@types`, named explicitly: the sources are compiled in a temporary directory, where
 * `tsc` would not find `@types/node` on its own — and coai's `helpPage.ts` imports `node:crypto`.
 */
const TYPE_ROOTS = fileURLToPath(new URL('../node_modules/@types', import.meta.url));

/**
 * Compile `sources` (module names under `src_vs_code/src/` at `ref`) together with `extra` files — a map of
 * relative path → text written beside them first: a `vscode` stub under `node_modules/`, or a module that
 * stands in for one of coai's. A top-level `.ts` among `extra` is compiled with the sources.
 *
 * Returns `{ load(name), dispose() }`; `load` requires a compiled module by name, `dispose` removes the
 * temporary directory and must be called.
 */
export function compileCoaiModules({ coai, ref, sources, extra = {} }) {
  const work = mkdtempSync(join(tmpdir(), 'kit-coai-'));
  try {
    for (const name of sources) {
      const text = execFileSync('git', ['-C', coai, 'show', `${ref}:src_vs_code/src/${name}.ts`], { encoding: 'utf8' });
      writeFileSync(join(work, `${name}.ts`), text);
    }
    for (const [path, text] of Object.entries(extra)) {
      mkdirSync(dirname(join(work, path)), { recursive: true });
      writeFileSync(join(work, path), text);
    }
    const extraSources = Object.keys(extra).filter((path) => path.endsWith('.ts') && !path.includes('/'));

    // `--ignoreConfig`: TypeScript 6 refuses files on the command line while this repository's own
    // `tsconfig.json` is in the cwd, and that config (rootDir `src`, `noEmitOnError`) is not for these files.
    execFileSync(process.execPath, [
      join('node_modules', 'typescript', 'bin', 'tsc'),
      '--ignoreConfig', '--module', 'commonjs', '--target', 'ES2022', '--outDir', join(work, 'out'),
      '--typeRoots', TYPE_ROOTS, '--types', 'node',
      ...sources.map((name) => join(work, `${name}.ts`)),
      ...extraSources.map((path) => join(work, path)),
    ], { stdio: 'inherit' });
  } catch (error) {
    rmSync(work, { recursive: true, force: true });
    throw error;
  }

  const require = createRequire(import.meta.url);
  return {
    load: (name) => require(join(work, 'out', `${name}.js`)),
    /** A file written through `extra`, required from where it was written (e.g. the `vscode` stub). */
    loadExtra: (path) => require(join(work, path)),
    dispose: () => rmSync(work, { recursive: true, force: true }),
  };
}
