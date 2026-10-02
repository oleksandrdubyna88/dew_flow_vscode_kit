import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';

import { sha256Hex } from '../help/sha256';

/**
 * The kit's own SHA-256 (`src/help/sha256.ts`) — pure TypeScript, because the digest sits on the path of
 * the PURE help modules (`bodyFor` → the page) and a `node:crypto` import there would make them host-only
 * (see `research/architecture.md`, *The help module*). A hand-written hash is only acceptable with two
 * controls, and these are both:
 *
 * 1. the standard's own vectors (FIPS 180-2, appendix B; the same five NIST CAVP publishes) — literals,
 *    each also printed by `node:crypto` on 2026-10-02 before this file was written;
 * 2. a differential run against `node:crypto` over every length across the padding boundaries and over
 *    seeded random text, lone surrogates included — so a bug that the five vectors happen to miss still
 *    has to agree with the platform's implementation byte for byte.
 */

const utf8 = (text: string): Uint8Array => new TextEncoder().encode(text);
const platform = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

const VECTORS: readonly { what: string; text: string; hex: string }[] = [
  { what: 'the empty message', text: '', hex: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855' },
  { what: '"abc" (one block)', text: 'abc', hex: 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad' },
  {
    what: 'the 448-bit message (padding spills into a second block)',
    text: 'abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq',
    hex: '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1',
  },
  {
    what: 'the 896-bit message',
    text: 'abcdefghbcdefghicdefghijdefghijkefghijklfghijklmghijklmnhijklmnoijklmnopjklmnopqklmnopqrlmnopqrsmnopqrstnopqrstu',
    hex: 'cf5b16a778af8380036ce59e7b0492370b249b11e8f07a51afac45037afee9d1',
  },
];

for (const vector of VECTORS) {
  test(`SHA-256 of ${vector.what} is the standard's vector`, () => {
    assert.equal(sha256Hex(utf8(vector.text)), vector.hex);
  });
}

test("SHA-256 of one million 'a' is the standard's vector (15 625 blocks)", () => {
  assert.equal(sha256Hex(utf8('a'.repeat(1_000_000))), 'cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0');
});

test('SHA-256 agrees with node:crypto at every length from 0 to 200 bytes, across every padding boundary', () => {
  for (let length = 0; length <= 200; length += 1) {
    const bytes = Uint8Array.from({ length }, (_, i) => (i * 31 + length) & 0xff);
    assert.equal(sha256Hex(bytes), platform(bytes), `length ${length}`);
  }
});

test('SHA-256 agrees with node:crypto over seeded random text: Cyrillic, emoji, NUL and lone surrogates', () => {
  // A seeded LCG, not Math.random: a failure names an input that the next run reproduces.
  let seed = 20261002;
  const next = (bound: number): number => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed % bound;
  };
  const alphabet = ['a', 'Z', ' ', '\n', '\r', '\u0000', 'ж', 'ї', 'ß', 'ñ', '€', '😀', '\ud800', '\udfff'];
  for (let round = 0; round < 300; round += 1) {
    const text = Array.from({ length: next(400) }, () => alphabet[next(alphabet.length)]).join('');
    const bytes = utf8(text);
    assert.equal(sha256Hex(bytes), platform(bytes), `round ${round}: ${JSON.stringify(text)}`);
  }
});

test('SHA-256 answers 64 lowercase hex characters and leaves its input as it was', () => {
  const bytes = utf8('leave me alone');
  const before = Uint8Array.from(bytes);

  assert.match(sha256Hex(bytes), /^[0-9a-f]{64}$/);
  assert.deepEqual(bytes, before);
});
