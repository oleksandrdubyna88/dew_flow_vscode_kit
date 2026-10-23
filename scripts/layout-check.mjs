#!/usr/bin/env node
/**
 * The layout check of the kit's OWN gallery: no table scrolls sideways, in a REAL browser
 * (`research/PLAN_kit_components_storybook.md` §4.6a). It is one caller of the shared core in `scripts/layout/` - the same
 * browser driver, probe and matrix the `vscode-webview-kit-layout-check` bin runs over a consumer's page
 * (`todo/PLAN_layout_check_bin.md` §3: ONE implementation); only the page is its own.
 *
 * jsdom has no layout, so "a table fits its box" cannot be asserted there. This script renders every DOM case of the
 * gallery (`src/test/gallery`) with `components.css` and the gallery's frame CSS into one static page
 * (`.storybook/layout-page.ts` builds it), and at every width x theme x text size asks the core's probe where a box does
 * not fit: the page scrolling sideways, an element past the window's edge, a box whose content is wider than the box, a
 * table wider than what holds it. Every case is rendered twice - in the page and inside an `18em` box. Any finding is a RED
 * run that names the case.
 *
 *   node scripts/layout-check.mjs              the check; exit 0 when every case fits, 1 when one does not
 *   node scripts/layout-check.mjs --companion  the check's own proof: stylesheets with a planted defect must each turn it
 *                                              RED naming a DataTable case, and the real stylesheet is never written
 *
 * Exit codes: 0 pass - 1 layout defect (or a companion that did not go RED) - 2 usage - 3 no browser, or it would not
 * start or answer. A missing browser is never a skip: a check that cannot run has not passed.
 *
 * Chrome, its profile and its clean-up are the core's (`scripts/layout/browser.mjs`). The pages are written to a folder
 * under the OS temp folder, removed when the run has ended.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

import { build } from 'esbuild';

import { buildLayout } from './build-layout.mjs';
import { DEFAULT_WIDTHS, SIZES, THEMES } from './layout/args.mjs';
import { withBrowser } from './layout/browser.mjs';
import { EnvironmentError, inlineStyle, removeWithRetry } from './layout/cleanup.mjs';
import { checkPages, readAssets } from './layout/core.mjs';
import { deadlines } from './layout/deadlines.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const COMPONENTS_CSS = join(ROOT, 'src', 'components', 'components.css');
const FRAME_CSS = join(ROOT, '.storybook', 'gallery.css');
const PAGE_ENTRY = join(ROOT, '.storybook', 'layout-page.ts');

const SETTINGS = { widths: DEFAULT_WIDTHS, themes: [...THEMES.keys()], sizes: [...SIZES.keys()] };

/** The planted defects of --companion: each, appended to a COPY of the stylesheet, must turn the check RED. */
const PLANTS = [
  ['a min-width of 40em on the table grid', '\n.kit-table__grid { min-width: 40em; }\n'],
  ['white-space: nowrap on every cell', '\n.kit-table td, .kit-table th { white-space: nowrap; }\n'],
];

// ---- the page -------------------------------------------------------------------------------------------------

/** The gallery bundled for the browser: the one list of cases, rendered by the kit's own components. */
async function bundle(outDir) {
  mkdirSync(outDir, { recursive: true });
  await build({ entryPoints: [PAGE_ENTRY], outfile: join(outDir, 'layout-page.js'), bundle: true, format: 'iife', platform: 'browser', logLevel: 'silent' });
}

/** The themes are not in the page: the core injects them, as it does for a consumer's page. */
function pageHtml(componentsCss) {
  const styles = [componentsCss, readFileSync(FRAME_CSS, 'utf8')].join('\n');

  return `<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><title>layout check</title>${inlineStyle(styles)}</head>\n<body class="vscode-dark"><script src="layout-page.js"></script></body></html>\n`;
}

/** Writes one page (the bundle beside it) using `css` as the components' stylesheet; answers the page for the core. */
async function writePage(work, name, css) {
  const dir = join(work, 'pages', name);
  await bundle(dir);
  writeFileSync(join(dir, 'index.html'), pageHtml(css));

  return { label: name, file: join(dir, 'index.html') };
}

// ---- one check ------------------------------------------------------------------------------------------------

/** The findings, one line per case: how many states it failed in, and the first of them. */
function summary(findings) {
  const byCase = new Map();
  for (const finding of findings) {
    const key = finding.group === '' ? finding.where : finding.group;
    const state = `${finding.width}px ${finding.theme} ${finding.size}`;
    const seen = byCase.get(key) ?? { first: { state, what: `${finding.where} ${finding.problem}` }, states: new Set() };
    seen.states.add(state);
    byCase.set(key, seen);
  }

  return [...byCase].map(([where, { first, states }]) => `  ${where}: ${states.size} state(s), first at ${first.state}: ${first.what}`);
}

async function runCheck(tools, work, assets, limits) {
  const page = await writePage(work, 'real', readFileSync(COMPONENTS_CSS, 'utf8'));
  const progress = (state, found) => { console.log(`layout-check: ${state} - ${found === 0 ? 'fits' : `${found} finding(s)`}`); };
  const { findings, states, groups } = await checkPages(tools, [page], SETTINGS, { assets, limits, progress });
  console.log(`layout-check: ${groups} case renders (${groups / 2} cases x in the page and in an 18em box) x ${SETTINGS.widths.length} widths x ${SETTINGS.themes.length} themes x ${SETTINGS.sizes.length} sizes = ${groups * states} case-states in ${states} page states.`);
  if (findings.length === 0) {
    console.log('layout-check: ok - nothing scrolls sideways, spills or is wider than its box.');

    return 0;
  }
  console.log(`layout-check: RED - ${new Set(findings.map((f) => (f.group === '' ? f.where : f.group))).size} case render(s) do not fit:\n${summary(findings).join('\n')}`);

  return 1;
}

function sha256(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

/** The check's own proof: each planted defect, in a COPY of the stylesheet, must turn it RED naming a DataTable case. */
async function runCompanion(tools, work, assets, limits) {
  const before = sha256(COMPONENTS_CSS);
  const original = readFileSync(COMPONENTS_CSS, 'utf8');
  let bad = 0;
  for (const [index, [what, plant]] of PLANTS.entries()) {
    const page = await writePage(work, `plant-${index}`, original + plant);
    const { findings } = await checkPages(tools, [page], SETTINGS, { assets, limits });
    const reds = new Set(findings.map((f) => f.group));
    const named = [...reds].filter((where) => where.startsWith('dataTable/'));
    console.log(`companion: planted ${what} -> ${findings.length === 0 ? 'STAYED GREEN' : `RED in ${reds.size} case render(s), DataTable ones named: ${named.slice(0, 3).join(', ')}${named.length > 3 ? ', ...' : ''}`}`);
    bad += named.length === 0 ? 1 : 0;
  }
  const after = sha256(COMPONENTS_CSS);
  console.log(`companion: components.css sha256 before ${before} after ${after} - ${before === after ? 'unchanged' : 'CHANGED'}`);
  const ok = bad === 0 && before === after;
  console.log(ok ? 'companion: ok - each planted defect turned the check RED, and the real stylesheet was never written.' : 'companion: FAILED');

  return ok ? 0 : 1;
}

// ---- main -----------------------------------------------------------------------------------------------------

/** The browser's run: the probe and themes built, then `mode` over the pages written beside them. */
async function inBrowser(mode, limits) {
  const work = { dir: '' };
  try {
    return await withBrowser(async (tools) => {
      work.dir = mkdtempSync(join(tmpdir(), 'testsToDelete-vscode-webview-kit-layout-gallery-'));
      await buildLayout(join(work.dir, 'assets'));

      return mode(tools, work.dir, readAssets(join(work.dir, 'assets')), limits);
    }, { limits });
  } finally {
    // After the browser has been stopped: while it runs it may hold the pages it loaded open.
    if (work.dir !== '') {
      await removeWithRetry(() => { rmSync(work.dir, { recursive: true, force: true }); }, { attempts: 60, pauseMs: 500, sleep }).catch((error) => {
        console.error(`layout-check: could not remove ${work.dir} (${error.message}) - the check's own result stands; delete the folder by hand`);
      });
    }
  }
}

const args = process.argv.slice(2);
if (args.some((arg) => arg !== '--companion')) {
  console.error('usage: node scripts/layout-check.mjs [--companion]');
  process.exit(2);
}
try {
  process.exitCode = await inBrowser(args.includes('--companion') ? runCompanion : runCheck, deadlines());
} catch (error) {
  console.error(`layout-check: ${error instanceof EnvironmentError ? 'cannot run' : 'FAILED'} - ${error.message}`);
  process.exitCode = error instanceof EnvironmentError ? 3 : 1;
}
