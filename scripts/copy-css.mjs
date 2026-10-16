#!/usr/bin/env node
/**
 * Copies the stylesheets the package ships from `src/` into `dist/`, beside the compiled modules that use them —
 * `tsc` copies only what it compiles (`todo/PLAN_kit_components_storybook.md` §4.2). Run by `npm run build` after
 * `tsc`, so `prepack` (and with it `npm pack` and `npm publish`) can never ship a `dist/` without its CSS.
 *
 *     node scripts/copy-css.mjs
 *
 * The list is DERIVED from the manifest: every `exports` target that ends in `.css` names the file under `dist/`, and
 * its source is the same path under `src/`. It writes only under `dist/` and deletes nothing.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));

const targets = Object.values(manifest.exports ?? {}).filter((target) => typeof target === 'string' && target.endsWith('.css'));
if (targets.length === 0) {
  console.error('copy-css: package.json exports no .css file — nothing to copy, and that is not expected');
  process.exit(1);
}
for (const target of targets) {
  const relative = target.replace(/^\.\//, '');
  if (!relative.startsWith('dist/')) {
    console.error(`copy-css: ${target} is not under dist/`);
    process.exit(1);
  }
  const source = join(ROOT, 'src', relative.slice('dist/'.length));
  if (!existsSync(source)) {
    console.error(`copy-css: ${target} has no source at ${source}`);
    process.exit(1);
  }
  mkdirSync(dirname(join(ROOT, relative)), { recursive: true });
  copyFileSync(source, join(ROOT, relative));
  console.log(`copy-css: ${relative}`);
}
