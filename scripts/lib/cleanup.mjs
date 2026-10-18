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
/**
 * The DevTools endpoint a started Chrome writes to `<profile>/DevToolsActivePort`, polled every `pollMs` for at most
 * `waitMs`. Throws `EnvironmentError` when Chrome exits first or the port never appears. A port file that is STILL
 * unreadable at the deadline is named in that error, so a file that never becomes readable is not mistaken for a
 * browser that never wrote one: the wait stays bounded either way.
 */
export async function endpointOf(child, { portFile, waitMs, pollMs = 100, read = (file) => readFileSync(file, 'utf8') }) {
  let unreadable = '';
  for (let waited = 0; waited < waitMs; waited += pollMs) {
    await sleep(pollMs);
    if (child.exitCode !== null) {
      throw new EnvironmentError(`Chrome exited with code ${child.exitCode} before it opened its DevTools port.`);
    }
    const seen = lines(portFile, read);
    unreadable = seen.unreadable;
    const [port, path] = seen.lines;
    if (port && path) {
      return `ws://127.0.0.1:${port.trim()}${path.trim()}`;
    }
  }
  const why = unreadable === '' ? '' : ` (its port file ${portFile} exists but could not be read: ${unreadable})`;
  throw new EnvironmentError(`Chrome did not open its DevTools port within ${waitMs / 1000} s${why}.`);
}

/**
 * Starts a browser and waits for its endpoint. When the wait fails, the browser is a process nobody else holds a handle
 * to - the caller never receives `started`, so its own shutdown cannot reach it - so it is ended HERE, by the handle
 * `spawnChild` returned (`end`), its exit awaited (`waitForExit`, bounded by the caller), and the ORIGINAL error rethrown.
 */
export async function startOrEnd({ spawnChild, endpointOf: awaitEndpoint, end, waitForExit }) {
  const started = spawnChild();
  try {
    return { ...started, endpoint: await awaitEndpoint(started) };
  } catch (error) {
    end(started);
    await waitForExit(started);

    throw error;
  }
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
 * Runs `run`, then ALWAYS `stop` and `remove`, and answers what `run` answered or throws what `run` threw. A removal that
 * fails is only reported through `warn`: tidying a throwaway folder must never replace a check's own result - a failed
 * check keeps its error, a passed check is not turned into a failure by a busy, git-ignored folder.
 */
export async function runThenRemove(run, { stop, remove, warn }) {
  try {
    return await run();
  } finally {
    await stop();
    try {
      await remove();
    } catch (error) {
      warn(error);
    }
  }
}
