import assert from 'node:assert/strict';
import { test } from 'node:test';

import { canonicalForm, digestOf, isDigest } from '../help/digest';
import type { HelpBody } from '../help/types';

/**
 * The digest of an English body, canonically (plan §2, gate round 1): the six fields in the fixed order
 * `title`, `whatItIs`, `why`, `setup`, `usage`, `whatCanGoWrong`, joined with U+0000, encoded UTF-8, **no
 * other normalisation**; the digest is the first 8 hex characters of SHA-256 over those bytes.
 *
 * "No other normalisation" is a decision, and the tests below hold it in both directions: a CR, a
 * trailing space, a decomposed accent are all CHANGES to the English text, so they change the digest.
 * The kit forces LF on its own sources (`.gitattributes`); a consumer whose checkout rewrites line
 * endings changes its English bodies, and being told so is the honest answer.
 */

const ASCII: HelpBody = {
  title: 'Title',
  whatItIs: 'What it is',
  why: 'Why',
  setup: 'Setup',
  usage: 'Usage',
  whatCanGoWrong: 'What can go wrong',
};

const CYRILLIC: HelpBody = {
  title: 'Заголовок',
  whatItIs: 'Что это',
  why: 'Зачем',
  setup: 'Настройка',
  usage: 'Использование',
  whatCanGoWrong: 'Что может пойти не так',
};

const edited = (body: HelpBody, change: Partial<HelpBody>): HelpBody => ({ ...body, ...change });

test('the digest vectors: computed independently by node:crypto over the canonical bytes', () => {
  // Computed on 2026-10-02, before digest.ts existed, by a scratch script running
  //   createHash('sha256').update(Buffer.from(fields.join('\u0000'), 'utf8')).digest('hex').slice(0, 8)
  // over the six values above, in the canonical order. The Cyrillic body is 130 UTF-8 bytes from 64
  // UTF-16 units, so it pins the encoding as well as the hash.
  assert.equal(digestOf(ASCII), 'fb76c375');
  assert.equal(digestOf(CYRILLIC), 'eafba843');
});

test('the canonical form is exactly the six fields in the fixed order, joined with U+0000', () => {
  assert.equal(canonicalForm(ASCII), 'Title\u0000What it is\u0000Why\u0000Setup\u0000Usage\u0000What can go wrong');
});

test('fields are read by name: the key order of an object literal does not change the digest', () => {
  const reordered: HelpBody = {
    whatCanGoWrong: 'What can go wrong',
    usage: 'Usage',
    setup: 'Setup',
    why: 'Why',
    whatItIs: 'What it is',
    title: 'Title',
  };

  assert.equal(digestOf(reordered), digestOf(ASCII));
});

test('the order is part of the format: swapping two fields’ texts changes the digest', () => {
  assert.notEqual(digestOf(edited(ASCII, { why: ASCII.setup, setup: ASCII.why })), digestOf(ASCII));
});

test('the separator keeps the fields apart: moving a character across a boundary changes the digest', () => {
  const before = edited(ASCII, { title: 'ab', whatItIs: 'c' });
  const after = edited(ASCII, { title: 'a', whatItIs: 'bc' });

  assert.notEqual(digestOf(after), digestOf(before));
});

test('no normalisation of line endings: CRLF and LF are different English texts', () => {
  const lf = edited(ASCII, { usage: 'one\ntwo' });
  const crlf = edited(ASCII, { usage: 'one\r\ntwo' });

  assert.notEqual(digestOf(crlf), digestOf(lf));
});

test('no normalisation of whitespace: a trailing space or newline is an edit', () => {
  assert.notEqual(digestOf(edited(ASCII, { why: 'Why ' })), digestOf(ASCII));
  assert.notEqual(digestOf(edited(ASCII, { whatCanGoWrong: 'What can go wrong\n' })), digestOf(ASCII));
});

test('no Unicode normalisation: a composed and a decomposed accent are different texts', () => {
  assert.notEqual(digestOf(edited(ASCII, { title: 'café' })), digestOf(edited(ASCII, { title: 'café' })));
});

test('anything beyond the six fields is not part of the body and does not move the digest', () => {
  const withExtra = { ...ASCII, note: 'not a section' };

  assert.equal(digestOf(withExtra), digestOf(ASCII));
});

test('a body missing a field is refused by name, not digested as if it were empty', () => {
  // A consumer in plain JavaScript can hand over what the type would not let through.
  const partial = { title: 'Title', whatItIs: 'x', why: 'x', setup: 'x', usage: 'x' } as unknown as HelpBody;

  assert.throws(() => digestOf(partial), /whatCanGoWrong/);
});

test('a digest is 8 lowercase hex characters, and nothing else reads as one', () => {
  assert.equal(isDigest(digestOf(ASCII)), true);
  assert.equal(isDigest('0a1b2c3d'), true);
  for (const wrong of ['0A1B2C3D', '0a1b2c3', '0a1b2c3d4', 'zzzzzzzz', '', 12345678, null, undefined]) {
    assert.equal(isDigest(wrong), false, `${String(wrong)} read as a digest`);
  }
});

test('digesting reads a body and never writes it', () => {
  const frozen = Object.freeze({ ...ASCII });

  assert.equal(digestOf(frozen), digestOf(ASCII));
  assert.deepEqual(frozen, ASCII);
});
