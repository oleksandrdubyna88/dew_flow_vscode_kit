import assert from 'node:assert/strict';

/**
 * Fails when `text` carries a carriage return, naming the index of the first one.
 *
 * The suite runs on Windows and on Linux and holds rendered output against literals copied from
 * ConnectOtherAIs' source. A CR that a checkout or a template literal smuggled into one platform's
 * output would make a byte-compat test pass on one runner and fail on the other, and the diff would
 * show two identical-looking strings. The index is what turns that into a one-line read.
 */
export function assertNoCr(text: string, what: string): void {
  const at = text.indexOf('\r');
  assert.equal(at, -1, `${what} carries a carriage return at index ${at}`);
}
