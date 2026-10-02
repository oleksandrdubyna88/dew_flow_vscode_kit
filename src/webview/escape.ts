import { asText } from '../text/asText';

/**
 * The HTML and script-body escapers every webview page needs.
 *
 * <p>Extracted from ConnectOtherAIs (`src_vs_code/src/webviewHtml.ts` at `1056aed9`), where the escaper
 * had once existed three times as byte-identical private copies — the day one was hardened, the other two
 * kept the old behaviour and nobody noticed. Pure: what it escapes is a unit test, not a claim.</p>
 */

/**
 * Escape a value for interpolation into HTML **text or a double-quoted attribute**.
 *
 * <p>The single quote is escaped as well as the double, although no template interpolates into a
 * single-quoted attribute today — "none does today" is exactly the assumption a later edit breaks.</p>
 *
 * <p>NOT for a value going into a `<script>` body ({@link jsonForScript}), a URL, or an unquoted
 * attribute.</p>
 */
export function escapeHtml(value: string): string {
  return escapeHtmlForHighlighting(value).replace(/'/g, '&#39;');
}

/**
 * The same escape with the **apostrophe left as data**, for text that is TOKENIZED after escaping
 * (a syntax highlighter recognises a single-quoted string BY its `'`). A different operation with one
 * kind of caller, not a weaker {@link escapeHtml}.
 */
export function escapeHtmlForHighlighting(value: string): string {
  return asText(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * JSON for interpolation INSIDE a `<script>` element.
 *
 * <p>`JSON.stringify` leaves `<` as it found it, and an HTML parser ends a script at `</script>` wherever
 * it appears — inside a string literal included. Escaping `<` as `<` keeps the text valid JSON and
 * closes `<!--` at the same time. Safe by construction, whatever the value is: a value is somebody's next
 * edit away from being different.</p>
 */
export function jsonForScript(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}
