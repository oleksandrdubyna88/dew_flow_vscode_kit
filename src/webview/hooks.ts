import type { Disposable } from '../display/port';

/**
 * Several hooks made in order, all or none — the constructor half of "`dispose()` unhooks everything".
 *
 * <p>A host that makes its hooks in one array literal leaks when a later registration throws: the
 * earlier ones are live, the object that would have disposed them was never made, and nothing can reach
 * them (gate, epic 2 code round, findings 2 and 3 — the display host's second setting listener, the help
 * panel's three hooks after its display attachment). So each maker runs in turn, and the first one that
 * throws undoes every hook made before it, newest first, before its error is rethrown as it was.</p>
 *
 * <p>An undo that throws too is not swallowed: the caller gets an `AggregateError` whose first error is
 * the registration's and whose rest are the undos', and every undo is still attempted.</p>
 */
export function hookAll(makers: readonly (() => Disposable)[]): readonly Disposable[] {
  const made: Disposable[] = [];
  try {
    for (const make of makers) {
      made.push(make());
    }
  } catch (failure: unknown) {
    throw undone(made, failure);
  }

  return Object.freeze(made);
}

/** Dispose what was made, newest first; the registration's own error, or it and every undo that failed. */
function undone(made: readonly Disposable[], failure: unknown): unknown {
  const undoFailures = [...made].reverse().flatMap(undoFailure);

  return undoFailures.length === 0
    ? failure
    : new AggregateError([failure, ...undoFailures], 'a hook could not be registered, and undoing the hooks before it failed too');
}

function undoFailure(hook: Disposable): unknown[] {
  try {
    hook.dispose();

    return [];
  } catch (failure: unknown) {
    return [failure];
  }
}
