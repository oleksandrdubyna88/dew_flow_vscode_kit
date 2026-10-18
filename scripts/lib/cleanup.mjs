/**
 * What a script does after the work it started, kept apart from `layout-check.mjs` so its decisions are testable
 * without a browser (`src/test/layoutCheck.test.ts`). No dependency, no I/O of its own: the removal, the pause and the
 * warning are handed in.
 */

/**
 * Calls `remove` until it stops throwing, at most `attempts` times, pausing `pauseMs` between calls; the last error is
 * thrown when every attempt failed. Bounded on purpose: a folder that stays busy must end the wait, not extend it.
 * `rmSync`'s own `maxRetries` is not used because on Windows it did not retry at all (Node 24 threw EPERM after 3 ms).
 */
export async function removeWithRetry(remove, { attempts, pauseMs, sleep }) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await remove();
    } catch (error) {
      if (attempt >= attempts) {
        throw error;
      }
      await sleep(pauseMs);
    }
  }
}

/**
 * Runs `run`, then ALWAYS `stop` and `remove`, and answers what `run` answered or throws what `run` threw. A removal that
 * fails is only reported through `warn`: tidying a throwaway folder must never replace a check's own result — a failed
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
