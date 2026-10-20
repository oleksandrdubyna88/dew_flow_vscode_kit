/**
 * The DataTable's order and filter, as pure functions over values — no DOM (`todo/PLAN_kit_components_storybook.md`
 * §4.6).
 *
 * <p><b>Absent is not zero</b> (`common.coding-style`): `null` is a value that could not be had. It sorts LAST in
 * both directions — never first because it is "smallest" — and the table shows it as `—`. A number that is not a
 * number (`NaN`) is absent too: it has no place in an order. Numbers compare numerically, strings by an `en`
 * collator with numeric parts (`file9` before `file10`), numbers before strings, and ties keep the order the rows
 * were given in, so a sort never shuffles equal rows.</p>
 */

/** What a column's `value` answers for a row: a number, a string, or `null` for absent. */
export type CellValue = string | number | null;

export type SortDirection = 'ascending' | 'descending';

export const SORT_DIRECTIONS: readonly SortDirection[] = ['ascending', 'descending'];

const COLLATOR = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });

/** `NaN` is absent: it has no place in an order. */
export function present(value: CellValue): value is string | number {
  return value !== null && !(typeof value === 'number' && Number.isNaN(value));
}

/** Two present values, ascending: numbers before strings, numbers numerically, strings by the collator. */
function compareAscending(a: string | number, b: string | number): number {
  if (typeof a === 'string' || typeof b === 'string') {
    return compareWithText(a, b);
  }

  return compareNumbers(a, b);
}

/** At least one side is text: two texts by the collator, otherwise the number first. */
function compareWithText(a: string | number, b: string | number): number {
  if (typeof a === 'string' && typeof b === 'string') {
    return COLLATOR.compare(a, b);
  }

  return typeof a === 'number' ? -1 : 1;
}

/** Two numbers, `±Infinity` included (a subtraction would answer `NaN` for two equal infinities). */
function compareNumbers(a: number, b: number): number {
  if (a === b) {
    return 0;
  }

  return a < b ? -1 : 1;
}

/** Two cells in `direction`, absent last whichever way. */
export function compareCells(a: CellValue, b: CellValue, direction: SortDirection): number {
  if (!present(a) || !present(b)) {
    return Number(!present(a)) - Number(!present(b));
  }
  const ascending = compareAscending(a, b);

  return direction === 'ascending' ? ascending : -ascending;
}

/** The row indexes `0 … values.length - 1` in the order `values` sort, ties by index. */
export function sortedIndexes(values: readonly CellValue[], direction: SortDirection): number[] {
  return values
    .map((_value, index) => index)
    .sort((i, j) => compareCells(values[i] ?? null, values[j] ?? null, direction) || i - j);
}

/** Whether a row whose shown texts are `texts` matches `query` — case-insensitive, trimmed; an empty query matches all. */
export function matchesQuery(texts: readonly string[], query: string): boolean {
  const wanted = query.trim().toLowerCase();

  return wanted.length === 0 || texts.some((shown) => shown.toLowerCase().includes(wanted));
}
