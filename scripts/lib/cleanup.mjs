/**
 * What a script does around a browser it started, kept apart from `layout-check.mjs` so its decisions are testable
 * without a browser (`src/test/layoutCheck.test.ts`). The pieces that touch the outside world - the spawn, the pause, the
 * removal, the warning, ending a process - are handed in; the only I/O of its own is reading the DevTools port file.
 */
import { existsSync, readFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

/** The machine, not the page: no browser, it would not start or answer. The check CANNOT RUN (exit 3), which is not a layout defect. */
export class EnvironmentError extends Error {}

/**
 * The port file's lines, or none yet. A file Chrome is still writing can be locked against a reader (EBUSY on Windows,
 * seen on a loaded machine: a green run died with `EBUSY ... DevToolsActivePort`), and that is "not yet", like a file that
 * does not exist: the next poll reads it.
 */
function lines(portFile, read) {
  try {
    return { lines: existsSync(portFile) ? read(portFile).split('\n') : [], unreadable: '' };
  } catch (error) {
    return { lines: [], unreadable: error?.code ?? String(error?.message ?? error) };
  }
}

/** A DevTools port is 1-65535, digits only. */
const validPort = (port) => /^\d{1,5}$/.test(port) && Number(port) >= 1 && Number(port) <= 65_535;

/** The DevTools browser path: under `/devtools/`, no query, no fragment, no whitespace - nothing a URL could be bent with. */
const validPath = (path) => path.startsWith('/devtools/') && !/[?#\s]/.test(path);

/** What the port file holds, as its first two lines; `valid` says whether they are a DevTools endpoint. */
function endpointIn(seen) {
  const [port = '', path = ''] = seen.map((line) => line.trim());
  if (port === '' && path === '') {
    return { valid: false, held: '' };
  }

  return { valid: validPort(port) && validPath(path), held: `${port} ${path}`.trim(), url: `ws://127.0.0.1:${port}${path}` };
}

/**
 * The DevTools endpoint a started Chrome writes to `<profile>/DevToolsActivePort`, polled every `pollMs` for at most
 * `waitMs`. Throws `EnvironmentError` when Chrome exits first, when it could not be started at all (`startError()` answers
 * the spawn's error: the wait rejects at the next poll, not at the deadline), or when no endpoint appears. A port file that
 * is STILL unreadable at the deadline, or holds something that is not a DevTools endpoint (a port outside 1-65535, a path
 * outside `/devtools/` or carrying `?`, `#` or whitespace), is named in that error: the wait stays bounded either way, and
 * a file that never becomes right is not mistaken for a browser that never wrote one.
 */
export async function endpointOf(child, { portFile, waitMs, pollMs = 100, read = (file) => readFileSync(file, 'utf8'), startError = () => undefined }) {
  let unreadable = '';
  let invalid = '';
  for (let waited = 0; waited < waitMs; waited += pollMs) {
    await sleep(pollMs);
    const failure = startError();
    if (failure !== undefined) {
      throw new EnvironmentError(`could not start Chrome: ${failure.message}`);
    }
    if (child.exitCode !== null) {
      throw new EnvironmentError(`Chrome exited with code ${child.exitCode} before it opened its DevTools port.`);
    }
    const seen = lines(portFile, read);
    unreadable = seen.unreadable;
    const found = endpointIn(seen.lines);
    if (found.valid) {
      return found.url;
    }
    invalid = found.held;
  }
  const why = unreadable === '' ? '' : ` (its port file ${portFile} exists but could not be read: ${unreadable})`;
  const bad = invalid === '' ? '' : ` (its port file ${portFile} holds something that is not a DevTools endpoint: ${invalid})`;
  throw new EnvironmentError(`Chrome did not open its DevTools port within ${waitMs / 1000} s${why}${bad}.`);
}

/**
 * Starts the browser process through `spawnProcess` and watches it: `exited` settles when it exits OR when it could not be
 * started, and `record.error` keeps a spawn error (ENOENT, EACCES) instead of swallowing it, for `endpointOf`'s `startError`.
 */
export function spawnBrowser(spawnProcess, chrome, args) {
  const child = spawnProcess(chrome, args, { stdio: 'ignore' });
  const record = { error: undefined };
  const exited = new Promise((done) => {
    child.once('exit', done);
    child.once('error', (error) => {
      record.error = error;
      done();
    });
  });

  return { child, exited, record };
}

/** Runs one clean-up step; a throw is handed to `warn` and swallowed, so a step never replaces what the caller is about to answer. */
async function settle(step, warn) {
  try {
    await step();
  } catch (error) {
    warn(error);
  }
}

/**
 * Starts a browser and waits for its endpoint. When the wait fails, the browser is a process nobody else holds a handle
 * to - the caller never receives `started`, so its own shutdown cannot reach it - so it is ended HERE, by the handle
 * `spawnChild` returned (`end`), its exit awaited (`waitForExit`, bounded by the caller), and the ORIGINAL error rethrown.
 * A clean-up step that itself throws is reported through `warn` and never replaces that error.
 */
export async function startOrEnd({ spawnChild, endpointOf: awaitEndpoint, end, waitForExit, warn = (error) => { console.error(`layout-check: could not end the browser cleanly (${error.message})`); } }) {
  const started = spawnChild();
  try {
    return { ...started, endpoint: await awaitEndpoint(started) };
  } catch (error) {
    await settle(() => end(started), warn);
    await settle(() => waitForExit(started), warn);

    throw error;
  }
}

/**
 * Answers what `promise` answers, or rejects with an `EnvironmentError` saying that `what` did not answer within `ms`,
 * running `onTimeout` first (close the socket, so the caller's clean-up can run). The timer never outlives the promise.
 */
export function withTimeout(promise, ms, what, onTimeout = () => undefined) {
  let timer;
  const timedOut = new Promise((_ok, fail) => {
    timer = setTimeout(() => {
      onTimeout();
      fail(new EnvironmentError(`${what} did not answer within ${ms / 1000} s.`));
    }, ms);
  });

  return Promise.race([promise, timedOut]).finally(() => { clearTimeout(timer); });
}

/**
 * Calls `remove` until it stops throwing, at most `attempts` times, pausing `pauseMs` between calls; the last error is
 * thrown when every attempt failed. Bounded on purpose: a folder that stays busy must end the wait, not extend it.
 * `rmSync`'s own `maxRetries` is not used because on Windows it did not retry at all (Node 24 threw EPERM after 3 ms).
 */
export async function removeWithRetry(remove, { attempts, pauseMs, sleep: pause }) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await remove();
    } catch (error) {
      if (attempt >= attempts) {
        throw error;
      }
      await pause(pauseMs);
    }
  }
}

/**
 * Runs `run`, then ALWAYS `stop` and `remove`, and answers what `run` answered or throws what `run` threw. A `stop` or a
 * removal that fails is only reported through `warn(error, 'stop' | 'remove')`: tidying up must never replace a check's own
 * result - a failed check keeps its error, a passed check is not turned into a failure by a busy, git-ignored folder.
 */
export async function runThenRemove(run, { stop, remove, warn }) {
  try {
    return await run();
  } finally {
    await settle(stop, (error) => { warn(error, 'stop'); });
    await settle(remove, (error) => { warn(error, 'remove'); });
  }
}
