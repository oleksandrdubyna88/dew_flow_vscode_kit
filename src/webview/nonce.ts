import { randomBytes } from 'node:crypto';

/**
 * A fresh Content-Security-Policy nonce for one render of one page.
 *
 * <p>HOST-only (it reaches `node:crypto`), deliberately kept out of the pure page modules — those take the
 * nonce as a parameter, which is also what lets a test render a page with a fixed one (gate, epic 1 plan
 * round: a `node:` import inside a pure module is refused by `architecture.test.ts`).</p>
 *
 * <p>16 random bytes, base64url: the shape ConnectOtherAIs' pages used.</p>
 */
export function nonce(): string {
  return randomBytes(16).toString('base64url');
}
