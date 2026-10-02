/**
 * A host's setting writes, one at a time and in order — and the wait a render makes for them.
 *
 * <p>Extracted from ConnectOtherAIs (`src_vs_code/src/writeQueue.ts` at `1056aed9`). The one hazard it
 * carries is run in a test: work running INSIDE the queue must never await {@link settled}, because while
 * it runs the queue IS that work, and the wait is a wait on itself — a page froze until the window was
 * reloaded the day that happened.</p>
 *
 * <p><b>Growth budget</b> (gate, plan round 1): one chain per queue, as long as the writes not yet done;
 * a settled write is not retained, and a failed one never stops the writes after it.</p>
 */
export class WriteQueue {
  private queued: Promise<void> = Promise.resolve();

  /** Appends one write. A failed write never stops the ones after it. */
  enqueue(work: () => Promise<void>): void {
    this.queued = this.queued.then(work, work).catch(() => undefined);
  }

  /**
   * Appends one write and hands back ITS outcome — for a caller that must report its own failure. The
   * queue still runs the next write after a failed one, exactly as {@link enqueue} does. Two quick presses
   * started without it both read the same value and one of them is lost.
   */
  run(work: () => Promise<void>): Promise<void> {
    const outcome = this.queued.then(work, work);
    this.queued = outcome.catch(() => undefined);

    return outcome;
  }

  /**
   * Resolves once the queue is STABLE: a write appended while this waited is waited for too. Bounded —
   * under continuous presses the queue never settles, and a render that waits for silence never happens.
   */
  async settled(): Promise<void> {
    for (let round = 0; round < 5; round += 1) {
      const seen = this.queued;
      await seen;
      if (seen === this.queued) {
        return;
      }
    }
  }
}
