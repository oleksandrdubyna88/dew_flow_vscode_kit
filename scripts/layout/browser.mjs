/**
 * Finding, starting, boxing in and ENDING the headless Chrome the layout check drives. Chrome is taken from CHROME_PATH,
 * then the platform's usual install paths (Edge as a fallback on Windows). Its profile is a fresh folder under the OS temp
 * folder, `testsToDelete-vscode-webview-kit-layout-check-<pid>-<random>`, removed in a `finally` and on SIGINT / SIGTERM.
 *
 * Only the process this script started is ever stopped, and by its PID - never by image name. The browser is a tree
 * (renderer, GPU, crash handler), so it is stopped as a tree: Windows `taskkill /PID <pid> /T /F`; elsewhere the browser
 * is spawned as the leader of its own process group and the group is signalled (`process.kill(-pid)`).
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

import { EnvironmentError, endpointOf, removeWithRetry, runThenRemove, spawnBrowser, startOrEnd } from './cleanup.mjs';
import { Devtools } from './devtools.mjs';

const PROFILE_PREFIX = 'testsToDelete-vscode-webview-kit-layout-check-';
/** A tree that will not end is reported, never waited for forever. */
const EXIT_WAIT_MS = 10_000;
const TASKKILL_MS = 30_000;
/** Exit code of a run ended by a signal: 128 + the signal's number. */
const SIGNALS = new Map([['SIGINT', 130], ['SIGTERM', 143], ['SIGHUP', 129], ['SIGBREAK', 149]]);

// ---- finding Chrome -------------------------------------------------------------------------------------------

function candidates(platform, env) {
  if (platform === 'win32') {
    const roots = [env.ProgramFiles, env['ProgramFiles(x86)'], env.LOCALAPPDATA].filter(Boolean);

    return [
      ...roots.map((root) => join(root, 'Google', 'Chrome', 'Application', 'chrome.exe')),
      ...roots.map((root) => join(root, 'Microsoft', 'Edge', 'Application', 'msedge.exe')),
    ];
  }
  if (platform === 'darwin') {
    return ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Chromium.app/Contents/MacOS/Chromium'];
  }
  const names = ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser'];
  const dirs = (env.PATH ?? '').split(':').filter(Boolean);

  return names.flatMap((name) => dirs.map((dir) => join(dir, name)));
}

export function findChrome(env = process.env, platform = process.platform) {
  // An explicit choice is never second-guessed: a CHROME_PATH that names nothing is an error, not a reason to run some other browser.
  const chosen = env.CHROME_PATH;
  if (chosen) {
    if (!existsSync(chosen)) {
      throw new EnvironmentError(`CHROME_PATH is set to ${chosen}, which does not exist.`);
    }

    return chosen;
  }
  const found = candidates(platform, env).find((path) => existsSync(path));
  if (found === undefined) {
    throw new EnvironmentError('no Chrome found: set CHROME_PATH, or install Google Chrome (Windows: C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe; Linux: google-chrome, google-chrome-stable or chromium on PATH). A layout check that cannot run has not passed.');
  }

  return found;
}

// ---- starting it ----------------------------------------------------------------------------------------------

/**
 * Chrome's command line. The network is shut at the browser as well as at the page (`netbox.mjs`): a dead proxy that
 * loopback does not bypass (`<-loopback>`), WebRTC limited to proxied UDP, no background networking.
 */
export function chromeArgs(profile, platform = process.platform) {
  return [
    '--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run', '--no-default-browser-check', '--disable-extensions',
    '--disable-background-networking', '--proxy-server=127.0.0.1:9', '--proxy-bypass-list=<-loopback>', '--force-webrtc-ip-handling-policy=disable_non_proxied_udp',
    // Linux only: GitHub's Ubuntu runner image restricts the unprivileged user namespaces Chrome's sandbox needs (AppArmor),
    // so headless Chrome does not start there with its sandbox. Acceptable for THIS tool only: it renders nothing but the
    // consumer's own page file, from a throwaway profile, with the network shut.
    ...(platform === 'linux' ? ['--no-sandbox'] : []),
    `--user-data-dir=${profile}`, '--remote-debugging-port=0', 'about:blank',
  ];
}

/**
 * Ends the process this script started, and what it started, by its PID. The profile is throwaway, so there is nothing to
 * close politely. `deps` are the outside world, handed in so the decision is testable without a browser.
 */
export function endBrowser(child, { platform = process.platform, run = spawnSync, killGroup = (pid, signal) => process.kill(-pid, signal) } = {}) {
  if (child.pid === undefined) {
    return;
  }
  if (platform === 'win32') {
    // /T ends the tree of that one PID while its parent is still alive.
    run('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', timeout: TASKKILL_MS });

    return;
  }
  try {
    killGroup(child.pid, 'SIGKILL');
  } catch {
    child.kill('SIGKILL');
  }
}

/**
 * The environment Chrome starts with: its temporary files go INTO the profile (measured: killed mid-run it leaves GUID-named
 * `.tmp` files in the temp folder), so they are removed with it instead of piling up in the person's temp folder.
 */
function browserEnv(profile) {
  const temp = join(profile, 'tmp');
  mkdirSync(temp, { recursive: true });

  return { ...process.env, TMP: temp, TEMP: temp, TMPDIR: temp };
}

/** Starts Chrome on `profile` and answers its handle with the DevTools endpoint it opened - or ends it and throws. */
function launch(chrome, profile, state, limits) {
  const portFile = join(profile, 'DevToolsActivePort');
  const args = chromeArgs(profile);

  return startOrEnd({
    spawnChild: () => {
      const started = spawnBrowser(spawn, chrome, args, { detached: process.platform !== 'win32', env: browserEnv(profile) });
      // Recorded at once: a signal that arrives while the endpoint is awaited must still reach this child.
      state.child = started.child;
      state.exited = started.exited;

      return started;
    },
    endpointOf: ({ child, record }) => endpointOf(child, { portFile, waitMs: limits.startMs, startError: () => record.error }),
    end: ({ child }) => { endBrowser(child); },
    waitForExit: ({ exited }) => Promise.race([exited, sleep(EXIT_WAIT_MS)]),
  });
}

// ---- ending it ------------------------------------------------------------------------------------------------

/** `step` runs once; every later call answers the same promise (a signal during the normal clean-up must not run it twice). */
function once(step) {
  let promise;

  return () => {
    promise ??= Promise.resolve().then(step);

    return promise;
  };
}

async function stopBrowser(state) {
  state.tools?.close();
  if (state.child !== undefined && state.child.exitCode === null) {
    endBrowser(state.child);
    await Promise.race([state.exited, sleep(EXIT_WAIT_MS)]);
  }
}

/**
 * Removes the profile folder, retrying for two minutes (240 x 500 ms, bounded). Chrome's helpers (the crash handler above
 * all) take up to 40 s to finish ending after the kill on a loaded Windows machine (measured), and until the last one is
 * gone the folder is busy (EPERM). `rmSync`'s own `maxRetries` does NOT help: Node 24 on Windows threw EPERM after 3 ms with
 * `maxRetries: 240` set (measured), so the retry is `removeWithRetry`'s (`cleanup.mjs`, unit-tested).
 */
function removeProfile(profile) {
  return removeWithRetry(() => { rmSync(profile, { recursive: true, force: true }); }, { attempts: 240, pauseMs: 500, sleep });
}

/** A browser that will not end cleanly, or a folder that stays busy, is reported and never thrown: the check's own result - its error or its pass - stands. */
function warnNotCleaned(error, what, profile, log) {
  log(what === 'stop'
    ? `layout-check: could not end the browser cleanly (${error.message}) - the check's own result stands`
    : `layout-check: could not remove ${profile} after two minutes (${error.message}) - the check's own result stands; delete the folder by hand`, 'error');
}

/**
 * Runs `cleanup` once when the process is told to stop (Ctrl+C, a kill, a closed terminal), then exits with 128 + the
 * signal's number. Answers a function that takes the handlers off again. `proc` and `exit` are handed in for the unit test.
 */
export function cleanOnSignals(cleanup, { proc = process, exit = (code) => process.exit(code) } = {}) {
  const handlers = [...SIGNALS].map(([signal, code]) => {
    const handler = () => { Promise.resolve().then(cleanup).catch(() => undefined).finally(() => { exit(code); }); };
    proc.once(signal, handler);

    return [signal, handler];
  });

  return () => { handlers.forEach(([signal, handler]) => { proc.removeListener(signal, handler); }); };
}

/**
 * Finds Chrome (BEFORE any profile exists: no browser, no folder), makes the profile, starts the browser, connects the
 * DevTools and runs `run(tools)`; then, whatever happened, stops the browser tree and removes the profile. `log(line,
 * level)` is where progress and warnings go.
 */
export async function withBrowser(run, { limits, log = (line, level) => { (level === 'error' ? console.error : console.log)(line); } }) {
  const chrome = findChrome();
  log(`layout-check: Chrome ${chrome}`);
  const profile = mkdtempSync(join(tmpdir(), `${PROFILE_PREFIX}${process.pid}-`));
  log(`layout-check: profile ${profile}`);
  const state = { tools: undefined, child: undefined, exited: undefined };
  const stop = once(() => stopBrowser(state));
  const remove = once(() => removeProfile(profile));
  const release = cleanOnSignals(async () => { await stop().catch(() => undefined); await remove(); });
  try {
    return await runThenRemove(async () => {
      const started = await launch(chrome, profile, state, limits);
      log('layout-check: the browser started');
      state.tools = await Devtools.connect(started.endpoint, limits);
      log('layout-check: connected to the DevTools');

      return run(state.tools);
    }, { stop, remove, warn: (error, what) => { warnNotCleaned(error, what, profile, log); } });
  } finally {
    release();
  }
}
