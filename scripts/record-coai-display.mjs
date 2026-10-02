#!/usr/bin/env node
/**
 * Re-records `src/test/fixtures/coai-display-1056aed9.json` from ConnectOtherAIs' OWN modules.
 *
 * <p>The byte-compatibility tests compare the kit against values the reference implementation COMPUTED,
 * never against literals somebody retyped (the family's testing rule: a value the code computes is read
 * back from the function that computes it). This script is how that fixture was made, so anyone can redo
 * it and diff.</p>
 *
 * Usage, from this repository's root, with a ConnectOtherAIs checkout beside it:
 *   node scripts/record-coai-display.mjs <path-to-dew_flow_connect_other_ais> [ref=1056aed9]
 *
 * It extracts the four source files at `ref` with `git show`, compiles them with this repository's own
 * TypeScript into a temporary directory, runs them over a fixed set of inputs and prints the JSON.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const [coai, ref = '1056aed9'] = process.argv.slice(2);
if (!coai) {
  process.stderr.write('usage: node scripts/record-coai-display.mjs <coai checkout> [ref]\n');
  process.exit(64);
}

const work = mkdtempSync(join(tmpdir(), 'kit-coai-'));
try {
  for (const name of ['asText', 'webviewHtml', 'zoomControl', 'textTone']) {
    const text = execFileSync('git', ['-C', coai, 'show', `${ref}:src_vs_code/src/${name}.ts`], { encoding: 'utf8' });
    writeFileSync(join(work, `${name}.ts`), text);
  }
  execFileSync(process.execPath, [
    join('node_modules', 'typescript', 'bin', 'tsc'),
    '--module', 'commonjs', '--target', 'ES2022', '--outDir', join(work, 'out'),
    ...['asText', 'webviewHtml', 'zoomControl', 'textTone'].map((n) => join(work, `${n}.ts`)),
  ], { stdio: 'inherit' });

  const require = createRequire(import.meta.url);
  const z = require(join(work, 'out', 'zoomControl.js'));
  const t = require(join(work, 'out', 'textTone.js'));
  const offsets = [-7, -5, -3, -1, 0, 1, 2, 3, 5, 9];
  const out = { source: `dew_flow_connect_other_ais@${ref} src_vs_code/src/{zoomControl,textTone}.ts`, zoom: {}, tone: {} };
  for (const o of offsets) {
    out.zoom[o] = { scalePx: z.scalePx(o), offsetLabel: z.offsetLabel(o), zoomControlHtml: z.zoomControlHtml(o), zoomStyle: z.zoomStyle(o) };
    out.tone[o] = {
      toneLabel: t.toneLabel(o),
      toneColour: t.toneColour(o),
      toneColourEditor: t.toneColour(o, 'var(--vscode-editor-foreground)'),
      toneStyle: t.toneStyle(o),
      toneControlHtml: t.toneControlHtml(o),
    };
  }
  out.zoomScript = z.zoomScript();
  out.ZOOM_CSS = z.ZOOM_CSS;
  out.toneScript = t.toneScript();
  out.TONE_CSS = t.TONE_CSS;
  out.clamp = {
    scale: [null, 'x', 2.9, -2.9, Infinity, NaN].map((v) => z.clampScale(v)),
    tone: [null, 'x', 2.9, -2.9, Infinity, NaN].map((v) => t.clampTone(v)),
  };
  process.stdout.write(JSON.stringify(out, null, 2) + '\n');
} finally {
  rmSync(work, { recursive: true, force: true });
}
