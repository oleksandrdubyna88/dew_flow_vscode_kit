import assert from 'node:assert/strict';
import { test } from 'node:test';

import { WriteQueue } from '../webview/writeQueue';

/** A write that finishes only when the test says so. */
function gate(): { readonly open: () => void; readonly wait: Promise<void> } {
  let open: () => void = () => undefined;
  const wait = new Promise<void>((resolve) => {
    open = resolve;
  });

  return { open, wait };
}

test('writes run one at a time, in the order they were appended', async () => {
  const queue = new WriteQueue();
  const order: string[] = [];
  const first = gate();

  queue.enqueue(async () => {
    order.push('first started');
    await first.wait;
    order.push('first done');
  });
  queue.enqueue(async () => {
    order.push('second');
  });
  await Promise.resolve();
  assert.deepEqual(order, ['first started'], 'the second ran before the first finished');

  first.open();
  await queue.settled();
  assert.deepEqual(order, ['first started', 'first done', 'second']);
});

test('two quick presses are two steps: the second reads what the first wrote', async () => {
  // The defect `run` exists for: started without waiting, both presses read 0 and one step was lost.
  const queue = new WriteQueue();
  let stored = 0;
  const press = (): Promise<void> => queue.run(async () => {
    const read = stored;
    await Promise.resolve();
    stored = read + 1;
  });

  await Promise.all([press(), press()]);

  assert.equal(stored, 2);
});

test('a failed write reaches its own caller and never stops the writes after it', async () => {
  const queue = new WriteQueue();
  const done: string[] = [];

  const failing = queue.run(async () => {
    throw new Error('refused');
  });
  const after = queue.run(async () => {
    done.push('after');
  });

  await assert.rejects(failing, /refused/);
  await after;
  assert.deepEqual(done, ['after']);
});

test('settled waits for a write appended while it waited, and is bounded under continuous writes', async () => {
  const queue = new WriteQueue();
  const done: number[] = [];
  queue.enqueue(async () => {
    done.push(1);
    queue.enqueue(async () => {
      done.push(2);
    });
  });

  await queue.settled();
  assert.deepEqual(done, [1, 2], 'the write appended during the wait was not waited for');

  // Growth budget: a queue that never stops growing must not make settled wait for ever.
  let keepGoing = true;
  const endless = (): void => queue.enqueue(async () => {
    if (keepGoing) {
      endless();
    }
  });
  endless();
  await queue.settled();
  keepGoing = false;
  await queue.settled();
});
