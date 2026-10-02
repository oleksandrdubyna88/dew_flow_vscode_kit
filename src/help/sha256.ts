/**
 * SHA-256 (FIPS 180-4), over bytes, to lowercase hex — pure, synchronous, no `node:` import.
 *
 * <p><b>Why the kit carries its own.</b> The help digest (`digest.ts`) is read by `bodyFor`, which the
 * pure page module calls to render a translation's stale note. `node:crypto` there would make the
 * catalog and the page HOST-only by import — exactly what `architecture.test.ts` exists to refuse — and
 * Web Crypto's `subtle.digest` is asynchronous, which would make every `bodyFor` a promise. So: a plain
 * implementation, used for CHANGE DETECTION only (a translation's `from` against the current English),
 * never for anything a secret depends on. Its correctness is pinned by the standard's vectors and by a
 * differential run against `node:crypto` (`src/test/sha256.test.ts`).</p>
 *
 * <p>The buffers below are local to one call and written in place; nothing the caller passed is.</p>
 */

/** The first 32 bits of the fractional parts of the cube roots of the first 64 primes (FIPS 180-4 §4.2.2). */
const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

/** The initial hash value: the first 32 bits of the fractional parts of the square roots of the first 8 primes (§5.3.3). */
const H0: readonly number[] = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];

const BLOCK_BYTES = 64;
/** The 0x80 marker byte plus the 64-bit message length that padding always appends. */
const PADDING_MINIMUM = 9;
const TWO_TO_THE_32 = 0x1_0000_0000;

/** The SHA-256 of `bytes`, as 64 lowercase hex characters. The input is not touched. */
export function sha256Hex(bytes: Uint8Array): string {
  const message = padded(bytes);
  const view = new DataView(message.buffer);
  const state = Uint32Array.from(H0);
  const schedule = new Uint32Array(64);
  for (let offset = 0; offset < message.length; offset += BLOCK_BYTES) {
    compress(state, schedule, view, offset);
  }

  return Array.from(state, (word) => word.toString(16).padStart(8, '0')).join('');
}

/** A copy of the message, padded to whole blocks: `0x80`, zeros, then the length in bits, big-endian (§5.1.1). */
function padded(bytes: Uint8Array): Uint8Array {
  const length = Math.ceil((bytes.length + PADDING_MINIMUM) / BLOCK_BYTES) * BLOCK_BYTES;
  const message = new Uint8Array(length);
  message.set(bytes);
  message[bytes.length] = 0x80;
  const bits = bytes.length * 8;
  const view = new DataView(message.buffer);
  view.setUint32(length - 8, Math.floor(bits / TWO_TO_THE_32));
  view.setUint32(length - 4, bits % TWO_TO_THE_32);

  return message;
}

function rotr(word: number, by: number): number {
  return (word >>> by) | (word << (32 - by));
}

/** The message schedule of one block (§6.2.2 step 1). A `Uint32Array` wraps every sum to 32 bits. */
function expand(w: Uint32Array, view: DataView, offset: number): void {
  for (let t = 0; t < 16; t += 1) {
    w[t] = view.getUint32(offset + t * 4);
  }
  for (let t = 16; t < 64; t += 1) {
    const s0 = rotr(w[t - 15], 7) ^ rotr(w[t - 15], 18) ^ (w[t - 15] >>> 3);
    const s1 = rotr(w[t - 2], 17) ^ rotr(w[t - 2], 19) ^ (w[t - 2] >>> 10);
    w[t] = w[t - 16] + s0 + w[t - 7] + s1;
  }
}

/** One block folded into the running state (§6.2.2 steps 2–4). */
function compress(state: Uint32Array, w: Uint32Array, view: DataView, offset: number): void {
  expand(w, view, offset);
  const v = Uint32Array.from(state);
  for (let t = 0; t < 64; t += 1) {
    round(v, K[t] + w[t]);
  }
  for (let i = 0; i < 8; i += 1) {
    state[i] += v[i];
  }
}

/** One of the 64 rounds over the working variables `a…h`, held as `v[0…7]`; the typed array wraps each to 32 bits. */
function round(v: Uint32Array, keyed: number): void {
  const a = v[0], b = v[1], c = v[2], d = v[3], e = v[4], f = v[5], g = v[6], h = v[7];
  const t1 = h + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + keyed;
  const t2 = (rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c));
  v[7] = g;
  v[6] = f;
  v[5] = e;
  v[4] = d + t1;
  v[3] = c;
  v[2] = b;
  v[1] = a;
  v[0] = t1 + t2;
}
