import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { Disposable } from '../display/port';
import { hookAll } from '../webview/hooks';

/**
 * `hookAll` — several hooks made in order, all or none. The display host and the help panel lean on it
 * for "a constructor that throws leaves nothing hooked"; their own suites hold that end to end, this one
 * holds the helper's contract: the order, the rollback, the error the caller sees.
 */

/** A maker that records its hook being made and undone in `log`, and can be told to fail either step. */
function maker(log: string[], name: string, fail: { make?: unknown; undo?: unknown } = {}): () => Disposable {
  return () => {
    if ('make' in fail) {
      throw fail.make;
    }
    log.push(`make ${name}`);

    return {
      dispose: () => {
        log.push(`undo ${name}`);
        if ('undo' in fail) {
          throw fail.undo;
        }
      },
    };
  };
}

test('every hook is made, in order, and handed back frozen, with nothing undone', () => {
  const log: string[] = [];

  const hooks = hookAll([maker(log, 'a'), maker(log, 'b'), maker(log, 'c')]);

  assert.deepEqual(log, ['make a', 'make b', 'make c']);
  assert.equal(hooks.length, 3);
  assert.ok(Object.isFrozen(hooks));
});

test('a maker that throws undoes the hooks made before it, newest first, and its own error is rethrown as it was', () => {
  const log: string[] = [];
  const refused = new Error('the third registration was refused');

  assert.throws(
    () => hookAll([maker(log, 'a'), maker(log, 'b'), maker(log, 'c', { make: refused }), maker(log, 'd')]),
    (reason: unknown) => reason === refused,
  );
  assert.deepEqual(log, ['make a', 'make b', 'undo b', 'undo a'], 'the maker after the failing one ran, or an earlier hook was left live');
});

test('a first maker that throws has nothing to undo, and a non-Error reason is rethrown untouched', () => {
  const log: string[] = [];

  assert.throws(() => hookAll([maker(log, 'a', { make: 'not an Error' })]), (reason: unknown) => reason === 'not an Error');
  assert.deepEqual(log, []);
});

test('an undo that throws too is not swallowed: every undo still runs, and the caller gets all the errors, the registration\'s first', () => {
  const log: string[] = [];
  const refused = new Error('registration refused');
  const undoA = new Error('undoing a failed');
  const undoB = new Error('undoing b failed');

  let caught: unknown;
  try {
    hookAll([maker(log, 'a', { undo: undoA }), maker(log, 'b', { undo: undoB }), maker(log, 'c', { make: refused })]);
  } catch (reason: unknown) {
    caught = reason;
  }

  assert.ok(caught instanceof AggregateError, `expected an AggregateError, got ${String(caught)}`);
  assert.deepEqual(caught.errors, [refused, undoB, undoA]);
  assert.deepEqual(log, ['make a', 'make b', 'undo b', 'undo a'], 'a failing undo stopped the undos after it');
});
