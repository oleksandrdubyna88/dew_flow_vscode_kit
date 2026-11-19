#!/usr/bin/env node
/**
 * vscode-webview-kit-layout-check: no table, box or page scrolls sideways, and cards side by side in one row have one
 * height - proved in a REAL browser over a consumer's OWN page file(s) (`todo/PLAN_layout_check_bin.md`, story E18.K2).
 *
 *   vscode-webview-kit-layout-check --page <file.html> [--page <file.html> ...]
 *       [--rows <css selector>] [--single-line <css selector>]
 *       [--widths 300,1280,1920] [--themes dark,light,high-contrast,high-contrast-light] [--sizes small,default,large]
 *       [--json <out.json>]
 *
 * The page links its own stylesheets and scripts; the bin injects only the four VS Code themes' resolved `--vscode-*`
 * values and the probe, then asks at every width x theme x text size where a box does not fit. The browser is boxed in: a
 * request for anything but a file under the page's own folder (or `data:` / `about:`) is failed and reported as a defect.
 *
 * Exit codes: 0 pass - 1 a layout defect (each named: page, width, theme, size, what) - 2 usage - 3 no browser, or it would
 * not start or answer. A missing browser is never a skip: a check that cannot run has not passed.
 *
 * Chrome is taken from CHROME_PATH, then the platform's usual install paths (Edge as a fallback on Windows). Its profile is
 * a fresh folder under the OS temp folder, removed when the run ends; only the browser this run started is ever stopped.
 */
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { USAGE, UsageError, parseArguments } from './args.mjs';
import { withBrowser } from './browser.mjs';
import { EnvironmentError } from './cleanup.mjs';
import { checkPages, readAssets } from './core.mjs';
import { deadlines } from './deadlines.mjs';
import { failLines, verdict, writeJson } from './report.mjs';

/** `dist/layout/`, beside `scripts/layout/` in the installed package. */
const ASSETS = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'dist', 'layout');

/** The run over parsed arguments. Answers the exit code, 0 or 1. */
async function run(settings) {
  const assets = readAssets(ASSETS);
  const limits = deadlines();
  const { findings, states } = await withBrowser((tools) => checkPages(tools, settings.pages, settings, { assets, limits }), { limits });
  failLines(findings).forEach((line) => { console.log(line); });
  console.log(verdict(findings, settings.pages.length, states));
  if (settings.json !== undefined) {
    writeJson(settings.json, { findings, pages: settings.pages.map((page) => page.label), states });
  }

  return findings.length === 0 ? 0 : 1;
}

/** What went wrong, as an exit code and a line on stderr. */
function failure(error) {
  if (error instanceof UsageError) {
    console.error(`vscode-webview-kit-layout-check: ${error.message}\n${USAGE}`);

    return 2;
  }
  const environment = error instanceof EnvironmentError;
  console.error(`layout-check: ${environment ? 'cannot run' : 'FAILED'} - ${error.message}`);

  return environment ? 3 : 1;
}

async function main(argv) {
  try {
    const settings = parseArguments(argv);
    if (settings.help) {
      console.log(USAGE);

      return 0;
    }

    return await run(settings);
  } catch (error) {
    return failure(error);
  }
}

process.exitCode = await main(process.argv.slice(2));
