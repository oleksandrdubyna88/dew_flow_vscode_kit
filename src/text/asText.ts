/**
 * Text, whatever the caller actually had.
 *
 * <p>Extracted from ConnectOtherAIs (`src_vs_code/src/asText.ts` at `1056aed9`). The parameter of an
 * escaper says `string`, TypeScript erases that at run time, and every value a webview renders comes from
 * JSON on disk that nothing fully validates — on 2026-09-08 a page failed with `e.replace is not a
 * function` because one field was not a string, and the page that would have let a person answer a
 * waiting question never rendered.</p>
 *
 * <p>Nullish becomes EMPTY rather than the word `undefined`; everything else is coerced and shown.</p>
 */
export function asText(value: unknown): string {
  return value === undefined || value === null ? '' : String(value);
}
