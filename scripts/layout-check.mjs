#!/usr/bin/env node
/**
 * The layout check: no table scrolls sideways, in a REAL browser (`todo/PLAN_kit_components_storybook.md` §4.6a).
 *
 * jsdom has no layout, so "a table fits its box" cannot be asserted there. This script renders every DOM case of the
 * gallery (`src/test/gallery`) with `components.css`, the four theme fixtures and the gallery's frame CSS into one
 * static page, drives headless Chrome over the DevTools protocol with Node's own `WebSocket` (no dependency), and at
 * every width x theme x text size asks the page's probe (`.storybook/layout-page.ts`) where a box does not fit: the page
 * scrolling sideways, an element past the window's edge, a box whose content is wider than the box, a table wider than
 * what holds it. Every case is rendered twice - in the page and inside an `18em` box. Any finding is a RED run that
 * names the case.
 *
 * The viewport is set with `Emulation.setDeviceMetricsOverride`: headless Chrome will not lay out narrower than about
 * 500 px from `--window-size`, so without the override a "300 px" check would silently be a 500 px one.
 *
 *   node scripts/layout-check.mjs              the check; exit 0 when every case fits, 1 when one does not
 *   node scripts/layout-check.mjs --companion  the check's own proof: stylesheets with a planted defect must each turn it
 *                                              RED naming a DataTable case, and the real stylesheet is never written
 *
 * Exit codes: 0 pass - 1 layout defect (or a companion that did not go RED) - 2 usage - 3 no browser, or it would not
 * start or answer. A missing browser is never a skip: a check that cannot run has not passed.
 *
 * Chrome is taken from CHROME_PATH, then the platform's usual install paths (Edge as a fallback on Windows). Its profile
 * lives in `testsToDelete-layout-check/` (git-ignored) and is removed in a `finally`; only the process this script
 * started is ever killed, through its own handle - never by image name.
 */
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { build } from 'esbuild';

import { EnvironmentError, endpointOf, removeWithRetry, runThenRemove, spawnBrowser, startOrEnd, withTimeout } from './lib/cleanup.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PROFILE = join(ROOT, 'testsToDelete-layout-check');
const COMPONENTS_CSS = join(ROOT, 'src', 'components', 'components.css');
const THEMES_CSS = join(ROOT, '.storybook', 'vscode-themes.css');
const FRAME_CSS = join(ROOT, '.storybook', 'gallery.css');
const PAGE_ENTRY = join(ROOT, '.storybook', 'layout-page.ts');

const WIDTHS = [300, 1280, 1920];
const THEMES = [['dark', 'vscode-dark'], ['light', 'vscode-light'], ['high-contrast', 'vscode-high-contrast'], ['high-contrast-light', 'vscode-high-contrast-light']];
const SIZES = [['small', 'kit-story-size-small'], ['default', 'kit-story-size-default'], ['large', 'kit-story-size-large']];
/** A loaded machine starts Chrome and loads a page slowly; a wait is a bound, never a pace. */
const WAIT_MS = 90_000;
/** The ceilings on the DevTools socket: opening it, and each command (a loaded machine is slow, never silent). */
const CONNECT_MS = 30_000;
const COMMAND_MS = 60_000;

/** The planted defects of --companion: each, appended to a COPY of the stylesheet, must turn the check RED. */
const PLANTS = [
  ['a min-width of 40em on the table grid', '\n.kit-table__grid { min-width: 40em; }\n'],
  ['white-space: nowrap on every cell', '\n.kit-table td, .kit-table th { white-space: nowrap; }\n'],
];

// ---- finding and starting Chrome ------------------------------------------------------------------------------

function candidates() {
  if (process.platform === 'win32') {
    const roots = [process.env.ProgramFiles, process.env['ProgramFiles(x86)'], process.env.LOCALAPPDATA].filter(Boolean);

    return [
      ...roots.map((root) => join(root, 'Google', 'Chrome', 'Application', 'chrome.exe')),
      ...roots.map((root) => join(root, 'Microsoft', 'Edge', 'Application', 'msedge.exe')),
    ];
  }
  if (process.platform === 'darwin') {
    return ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Chromium.app/Contents/MacOS/Chromium'];
  }
  const names = ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser'];
  const dirs = (process.env.PATH ?? '').split(':').filter(Boolean);

  return [...names.flatMap((name) => dirs.map((dir) => join(dir, name)))];
}

function findChrome() {
  // An explicit choice is never second-guessed: a CHROME_PATH that names nothing is an error, not a reason to run some other browser.
  const chosen = process.env.CHROME_PATH;
  if (chosen) {
    if (!existsSync(chosen)) {
      throw new EnvironmentError(`CHROME_PATH is set to ${chosen}, which does not exist.`);
    }

    return chosen;
  }
  const found = candidates().find((path) => existsSync(path));
  if (found === undefined) {
    throw new EnvironmentError('no Chrome found: set CHROME_PATH, or install Google Chrome (Windows: C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe; Linux: google-chrome, google-chrome-stable or chromium on PATH). A layout check that cannot run has not passed.');
  }

  return found;
}

/** Starts Chrome on its own profile and answers its handle with the DevTools endpoint it opened - or ends it and throws. */
function launch(chrome) {
  // A port file left by an earlier run names a port nobody listens on any more.
  const portFile = join(PROFILE, 'DevToolsActivePort');
  rmSync(portFile, { force: true });
  const args = [
    '--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run', '--no-default-browser-check', '--allow-file-access-from-files',
    ...(process.platform === 'linux' ? ['--no-sandbox'] : []),
    `--user-data-dir=${PROFILE}`, '--remote-debugging-port=0', 'about:blank',
  ];

  return startOrEnd({
    spawnChild: () => spawnBrowser(spawn, chrome, args),
    endpointOf: ({ child, record }) => endpointOf(child, { portFile, waitMs: WAIT_MS, startError: () => record.error }),
    end: ({ child }) => { endBrowser(child); },
    waitForExit: ({ exited }) => Promise.race([exited, sleep(10_000)]),
  });
}

// ---- the DevTools protocol, over Node's own WebSocket -----------------------------------------------------------

class Devtools {
  #socket;
  #next = 1;
  #waiting = new Map();
  #listeners = [];

  static async connect(endpoint) {
    const tools = new Devtools(new WebSocket(endpoint));
    const opened = new Promise((done, fail) => {
      tools.#socket.onopen = done;
      tools.#socket.onerror = () => { fail(new EnvironmentError('the DevTools socket would not open.')); };
    });
    await withTimeout(opened, CONNECT_MS, 'the DevTools socket opening', () => { tools.close(); });

    return tools;
  }

  constructor(socket) {
    this.#socket = socket;
    socket.onmessage = (event) => { this.#route(JSON.parse(String(event.data))); };
  }

  #route(message) {
    if (message.id !== undefined && this.#waiting.has(message.id)) {
      const { ok, fail } = this.#waiting.get(message.id);
      this.#waiting.delete(message.id);
      if (message.error) {
        fail(new Error(JSON.stringify(message.error)));
      } else {
        ok(message.result);
      }
    } else if (message.method) {
      this.#listeners.slice().forEach((listener) => { listener(message); });
    }
  }

  send(method, params = {}, sessionId = undefined) {
    const id = this.#next++;
    const answered = new Promise((ok, fail) => { this.#waiting.set(id, { ok, fail }); });
    this.#socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));

    // A command Chrome never answers must end the run (so the clean-up runs), not hang it: the socket is closed at the ceiling.
    return withTimeout(answered, COMMAND_MS, `the DevTools command ${method}`, () => {
      this.#waiting.delete(id);
      this.close();
    });
  }

  /** Waits for ONE event of `method` in `sessionId`; register it BEFORE the call that causes it. */
  once(method, sessionId) {
    return new Promise((ok, fail) => {
      const timer = setTimeout(() => { fail(new EnvironmentError(`timed out waiting for ${method}`)); }, WAIT_MS);
      const listener = (message) => {
        if (message.method === method && message.sessionId === sessionId) {
          clearTimeout(timer);
          this.#listeners.splice(this.#listeners.indexOf(listener), 1);
          ok(message.params);
        }
      };
      this.#listeners.push(listener);
    });
  }

  on(listener) {
    this.#listeners.push(listener);
  }

  close() {
    this.#socket.close();
  }
}

/** A page of its own: attached, with its exceptions collected. */
async function openPage(tools) {
  const { targetId } = await tools.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await tools.send('Target.attachToTarget', { targetId, flatten: true });
  await tools.send('Page.enable', {}, sessionId);
  await tools.send('Runtime.enable', {}, sessionId);
  const exceptions = [];
  tools.on((message) => {
    if (message.sessionId === sessionId && message.method === 'Runtime.exceptionThrown') {
      exceptions.push(message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text);
    }
  });

  return { sessionId, exceptions };
}

/** Navigates and waits for the load. A hash-only change fires no load, so every visit goes through about:blank. */
async function visit(tools, page, url) {
  for (const target of ['about:blank', url]) {
    const loaded = tools.once('Page.loadEventFired', page.sessionId);
    await tools.send('Page.navigate', { url: target }, page.sessionId);
    await loaded;
  }
}

async function evaluate(tools, page, expression) {
  const { result, exceptionDetails } = await tools.send('Runtime.evaluate', { expression, returnByValue: true }, page.sessionId);
  if (exceptionDetails) {
    throw new Error(`the page threw: ${exceptionDetails.exception?.description ?? exceptionDetails.text}`);
  }

  return result.value;
}

// ---- the page ---------------------------------------------------------------------------------------------------

/** The gallery bundled for the browser: the one list of cases, rendered by the kit's own components. */
async function bundle(outDir) {
  mkdirSync(outDir, { recursive: true });
  await build({ entryPoints: [PAGE_ENTRY], outfile: join(outDir, 'layout-page.js'), bundle: true, format: 'iife', platform: 'browser', logLevel: 'silent' });
}

function pageHtml(componentsCss) {
  const styles = [componentsCss, readFileSync(THEMES_CSS, 'utf8'), readFileSync(FRAME_CSS, 'utf8')].join('\n');

  return `<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><title>layout check</title><style>${styles}</style></head>\n<body class="vscode-dark kit-story-size-default"><script src="layout-page.js"></script></body></html>\n`;
}

/** Writes one page (the bundle beside it) using `css` as the components' stylesheet; answers its file URL. */
async function writePage(name, css) {
  const dir = join(PROFILE, 'pages', name);
  await bundle(dir);
  writeFileSync(join(dir, 'index.html'), pageHtml(css));

  return pathToFileURL(join(dir, 'index.html')).href;
}

// ---- one check --------------------------------------------------------------------------------------------------

/** Every width x theme x size over one page; answers the findings as `{ where, state, what }`. */
async function checkPage(tools, page, url, progress = () => undefined) {
  const findings = [];
  let cases = [];
  let states = 0;
  for (const width of WIDTHS) {
    await tools.send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false }, page.sessionId);
    page.exceptions.length = 0;
    await visit(tools, page, url);
    cases = await evaluate(tools, page, 'window.__kitLayout ? window.__kitLayout.cases : null') ?? [];
    for (const [theme, themeClass] of THEMES) {
      for (const [size, sizeClass] of SIZES) {
        states += 1;
        const report = JSON.parse(await evaluate(tools, page, `window.__kitLayout.apply(${JSON.stringify(themeClass)}, ${JSON.stringify(sizeClass)})`));
        const state = `${width}px ${theme} ${size}`;
        const before = findings.length;
        report.page.forEach((what) => findings.push({ where: 'the page', state, what }));
        report.sections.forEach((section) => section.problems.forEach((what) => findings.push({ where: section.where, state, what })));
        [...report.errors, ...page.exceptions].forEach((what) => findings.push({ where: 'the page script', state, what }));
        progress(state, findings.length - before);
      }
    }
  }

  return { findings, cases, states };
}

/** The findings, one line per case: how many states it failed in, and the first of them. */
function summary(findings) {
  const byCase = new Map();
  for (const finding of findings) {
    const seen = byCase.get(finding.where) ?? { first: finding, states: new Set() };
    seen.states.add(finding.state);
    byCase.set(finding.where, seen);
  }

  return [...byCase].map(([where, { first, states }]) => `  ${where}: ${states.size} state(s), first at ${first.state}: ${first.what}`);
}

function sha256(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

async function runCheck(tools) {
  const page = await openPage(tools);
  const url = await writePage('real', readFileSync(COMPONENTS_CSS, 'utf8'));
  const { findings, cases, states } = await checkPage(tools, page, url, (state, found) => { console.log(`layout-check: ${state} - ${found === 0 ? 'fits' : `${found} finding(s)`}`); });
  console.log(`layout-check: ${cases.length} case renders (${cases.length / 2} cases x in the page and in an 18em box) x ${WIDTHS.length} widths x ${THEMES.length} themes x ${SIZES.length} sizes = ${cases.length * states} case-states in ${states} page states.`);
  if (findings.length === 0) {
    console.log('layout-check: ok - nothing scrolls sideways, spills or is wider than its box.');

    return 0;
  }
  console.log(`layout-check: RED - ${new Set(findings.map((f) => f.where)).size} case render(s) do not fit:\n${summary(findings).join('\n')}`);

  return 1;
}

/** The check's own proof: each planted defect, in a COPY of the stylesheet, must turn it RED naming a DataTable case. */
async function runCompanion(tools) {
  const before = sha256(COMPONENTS_CSS);
  const original = readFileSync(COMPONENTS_CSS, 'utf8');
  let bad = 0;
  for (const [index, [what, plant]] of PLANTS.entries()) {
    const page = await openPage(tools);
    const { findings } = await checkPage(tools, page, await writePage(`plant-${index}`, original + plant));
    const named = [...new Set(findings.map((f) => f.where))].filter((where) => where.startsWith('dataTable/'));
    console.log(`companion: planted ${what} -> ${findings.length === 0 ? 'STAYED GREEN' : `RED in ${new Set(findings.map((f) => f.where)).size} case render(s), DataTable ones named: ${named.slice(0, 3).join(', ')}${named.length > 3 ? ', ...' : ''}`}`);
    bad += named.length === 0 ? 1 : 0;
  }
  const after = sha256(COMPONENTS_CSS);
  console.log(`companion: components.css sha256 before ${before} after ${after} - ${before === after ? 'unchanged' : 'CHANGED'}`);
  const ok = bad === 0 && before === after;
  console.log(ok ? 'companion: ok - each planted defect turned the check RED, and the real stylesheet was never written.' : 'companion: FAILED');

  return ok ? 0 : 1;
}

// ---- main -------------------------------------------------------------------------------------------------------

async function withBrowser(run) {
  rmSync(PROFILE, { recursive: true, force: true });
  mkdirSync(PROFILE, { recursive: true });
  let started;
  let tools;

  return runThenRemove(async () => {
    started = await launch(findChrome());
    tools = await Devtools.connect(started.endpoint);

    return run(tools);
  }, { stop: () => shutDown(tools, started), remove: removeProfile, warn: warnNotCleaned });
}

/**
 * Removes the profile folder, retrying for two minutes (240 x 500 ms, bounded). Chrome's helpers (the crash handler above
 * all) take up to 40 s to finish ending after the kill on a loaded Windows machine (measured), and until the last one is
 * gone the folder is busy (EPERM). `rmSync`'s own `maxRetries` does NOT help: Node 24 on Windows threw EPERM after 3 ms with
 * `maxRetries: 240` set (measured), so the retry is `removeWithRetry`'s (`scripts/lib/cleanup.mjs`, unit-tested).
 */
function removeProfile() {
  return removeWithRetry(() => { rmSync(PROFILE, { recursive: true, force: true }); }, { attempts: 240, pauseMs: 500, sleep });
}

/** A browser that will not end cleanly, or a folder that stays busy, is reported and never thrown: the check's own result - its error or its pass - stands. */
function warnNotCleaned(error, what) {
  if (what === 'stop') {
    console.error(`layout-check: could not end the browser cleanly (${error.message}) — the check's own result stands`);

    return;
  }
  console.error(`layout-check: could not remove ${PROFILE} after two minutes (${error.message}) — the check's own result stands; delete the folder by hand`);
}

/**
 * Ends the process this script started, and what it started, by its PID - never by image name. The profile is throwaway,
 * so there is nothing to close politely: on Windows `taskkill /T` ends the tree of that one PID while its parent is
 * still alive, elsewhere the process is signalled through its handle.
 */
function endBrowser(child) {
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', timeout: 30_000 });

    return;
  }
  child.kill();
}

async function shutDown(tools, started) {
  tools?.close();
  if (started !== undefined && started.child.exitCode === null) {
    endBrowser(started.child);
    await Promise.race([started.exited, sleep(10_000)]);
  }
}

const args = process.argv.slice(2);
if (args.some((arg) => arg !== '--companion')) {
  console.error('usage: node scripts/layout-check.mjs [--companion]');
  process.exit(2);
}
try {
  process.exitCode = await withBrowser(args.includes('--companion') ? runCompanion : runCheck);
} catch (error) {
  console.error(`layout-check: ${error instanceof EnvironmentError ? 'cannot run' : 'FAILED'} - ${error.message}`);
  process.exitCode = error instanceof EnvironmentError ? 3 : 1;
}
