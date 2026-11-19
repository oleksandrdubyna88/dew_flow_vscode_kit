#!/usr/bin/env node
/**
 * Builds what the layout bin injects into a page, from one source each (`todo/PLAN_layout_check_bin.md` §3):
 *
 *   dist/layout/probe.js          `src/layout/probe.ts`, bundled for the browser (esbuild, a devDependency - the bin itself has none)
 *   dist/layout/vscode-themes.css `.storybook/vscode-themes.css`, copied: the resolved --vscode-* values of the four themes
 *
 *     node scripts/build-layout.mjs [--out <dir>]     (default: dist/layout)
 *
 * Run by `npm run build` after `tsc`. Writes only under the output folder.
 */
import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { build } from 'esbuild';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Builds the probe and copies the theme sheet into `outDir`. */
export async function buildLayout(outDir) {
  mkdirSync(outDir, { recursive: true });
  await build({ entryPoints: [join(ROOT, 'src', 'layout', 'probe.ts')], outfile: join(outDir, 'probe.js'), bundle: true, format: 'iife', platform: 'browser', target: 'es2022', logLevel: 'silent' });
  copyFileSync(join(ROOT, '.storybook', 'vscode-themes.css'), join(outDir, 'vscode-themes.css'));
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const out = args[0] === '--out' && args[1] !== undefined ? resolve(args[1]) : join(ROOT, 'dist', 'layout');
  if (args.length !== 0 && !(args.length === 2 && args[0] === '--out')) {
    console.error('usage: node scripts/build-layout.mjs [--out <dir>]');
    process.exit(2);
  }
  await buildLayout(out);
  console.log(`build-layout: ${out}`);
}
