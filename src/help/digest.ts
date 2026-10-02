import { sha256Hex } from './sha256';
import { HELP_BODY_FIELDS, type Digest, type HelpBody } from './types';

/**
 * The digest of an English help body — what a translation records in its `from` map so a later edit of
 * the English is visible as a stale translation.
 *
 * <p><b>Canonically</b> (plan §2, gate round 1): the six fields in the fixed order of `HELP_BODY_FIELDS`
 * — `title`, `whatItIs`, `why`, `setup`, `usage`, `whatCanGoWrong` — joined with U+0000, encoded UTF-8,
 * <b>no other normalisation</b>; the digest is the first 8 hex characters of SHA-256 over those bytes.
 * U+0000 cannot occur in a body a person writes, so moving a character across a field boundary is a
 * different digest. A CR, a trailing space and a decomposed accent are each an edit of the English and
 * change it too: the kit's sources are LF by `.gitattributes`, and a checkout that rewrites a consumer's
 * line endings has rewritten its English.</p>
 *
 * <p>8 hex characters are 32 bits: a CHANGE detector over a few dozen articles, where two different
 * English texts sharing a digest by chance is one in four billion per edit — not an integrity check, and
 * never used as one.</p>
 */

export const DIGEST_LENGTH = 8;
const FIELD_SEPARATOR = '\u0000';
const DIGEST_SHAPE = /^[0-9a-f]{8}$/;

/**
 * The text the digest is taken over: the six fields, by name, in the fixed order, U+0000 between them.
 * A field that is not text is refused by name — a consumer in plain JavaScript can hand over a body the
 * type would not let through, and `join` would read a missing field as empty.
 */
export function canonicalForm(body: HelpBody): string {
  const missing = fieldNotText(body);
  if (missing !== undefined) {
    throw new TypeError(`A help body's ${missing} is not text: every one of ${HELP_BODY_FIELDS.join(', ')} is required.`);
  }

  return HELP_BODY_FIELDS.map((field) => body[field]).join(FIELD_SEPARATOR);
}

/** The first of the six fields that is not a string, or nothing when the body is whole. The one check of a body's shape. */
export function fieldNotText(body: object): keyof HelpBody | undefined {
  return HELP_BODY_FIELDS.find((field) => typeof Reflect.get(body, field) !== 'string');
}

/** The digest of one English body: 8 lowercase hex characters. */
export function digestOf(body: HelpBody): Digest {
  return sha256Hex(new TextEncoder().encode(canonicalForm(body))).slice(0, DIGEST_LENGTH);
}

/** Whether a value has the shape of a digest — what a translation's `from` entry must be. */
export function isDigest(value: unknown): value is Digest {
  return typeof value === 'string' && DIGEST_SHAPE.test(value);
}
