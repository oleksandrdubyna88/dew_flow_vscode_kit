/**
 * The boundary checks every component runs on what a consumer hands it. A component is built from a consumer's
 * options once, and a mistake there — an empty label, a repeated id, an unknown tone — is a programming error, so it
 * is refused at once with a `TypeError` that names what and where, never rendered as a blank or a guess
 * (`common.coding-style`: an unknown name fails naming the legal values).
 */

/** What an id, a key or an id prefix may look like: it becomes part of an element id and a `data-kit-*` value. */
export const ID_SHAPE = /^[a-z][a-z0-9-]*$/;

/** `value` as non-empty text, or a `TypeError` naming `what`. */
export function text(value: unknown, what: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(`${what} must be non-empty text, got ${describe(value)}.`);
  }

  return value;
}

/** `value` as an id of the shape {@link ID_SHAPE}, or a `TypeError` naming `what`. */
export function id(value: unknown, what: string): string {
  if (typeof value !== 'string' || !ID_SHAPE.test(value)) {
    throw new TypeError(`${what} must match ${String(ID_SHAPE)} (lowercase letters, digits and dashes), got ${describe(value)}.`);
  }

  return value;
}

/** `value` as a function, or a `TypeError` naming `what`. */
export function callable<F>(value: F | undefined, what: string): F {
  if (typeof value !== 'function') {
    throw new TypeError(`${what} must be a function, got ${describe(value)}.`);
  }

  return value;
}

/** `value` as a non-empty array, or a `TypeError` naming `what`. */
export function list<T>(value: readonly T[] | undefined, what: string): readonly T[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new TypeError(`${what} must be a non-empty list, got ${describe(value)}.`);
  }

  return value;
}

/** The first value that occurs twice, or `undefined`. */
export function repeated(values: readonly string[]): string | undefined {
  return values.find((value, index) => values.indexOf(value) !== index);
}

/** One of `allowed`, or a `TypeError` naming `what` and every legal value. */
export function oneOf<T extends string>(value: unknown, allowed: readonly T[], what: string): T {
  const found = allowed.find((candidate) => candidate === value);
  if (found === undefined) {
    throw new TypeError(`${what} must be one of ${allowed.join(', ')}, got ${describe(value)}.`);
  }

  return found;
}

/** A value as an error message shows it: strings quoted, everything else by its type. */
export function describe(value: unknown): string {
  return typeof value === 'string' ? JSON.stringify(value) : typeof value;
}
