import { oneOf, text } from './checks';
import { attributes, children, element, type KitDocument, type KitElement } from './dom';

/**
 * The status tones a tab or a recommendation carries — and the rule that colour is never the only signal.
 *
 * <p>A tone paints a glyph and a border in its colour (`components.css`, `--kit-tone-*-mark`); the WORD beside it is
 * required, non-empty, and drawn in the normal foreground, so a reader who cannot tell the colours apart — or a
 * theme whose warning colour is faint — still reads the status. The glyph is `aria-hidden`: the word is what a
 * screen reader says.</p>
 *
 * <p>"Tone" here is a STATUS tone. The ± text tone of `display/tone.ts` is a different thing, which is why the type
 * is `StatusTone`.</p>
 */

export const STATUS_TONES = ['neutral', 'info', 'ok', 'warning', 'critical'] as const;

export type StatusTone = (typeof STATUS_TONES)[number];

/** A status as a component shows it: its tone and the word that says it. */
export interface StatusMark {
  readonly tone: StatusTone;
  readonly word: string;
}

/** The glyph each tone shows beside its word. Plain characters — the page loads no image and no font. */
const GLYPHS: Readonly<Record<StatusTone, string>> = {
  neutral: '•',
  info: 'ℹ',
  ok: '✓',
  warning: '⚠',
  critical: '✕',
};

/** The glyph a tone shows. */
export function toneGlyph(tone: StatusTone): string {
  return GLYPHS[tone];
}

/** `value` as a tone, or a `TypeError` naming `what` and the five tones. */
export function checkedTone(value: unknown, what: string): StatusTone {
  return oneOf(value, STATUS_TONES, what);
}

/** `value` as a status mark — a known tone and a non-empty word — or a `TypeError` naming `what`. */
export function checkedMark(value: unknown, what: string): StatusMark {
  if (typeof value !== 'object' || value === null) {
    throw new TypeError(`${what} must be { tone, word }, got ${value === null ? 'null' : typeof value}.`);
  }
  const { tone, word } = value as { readonly tone?: unknown; readonly word?: unknown };

  return { tone: checkedTone(tone, `${what}.tone`), word: text(word, `${what}.word`) };
}

/** `span.kit-mark.kit-mark--<tone>`: the glyph (`aria-hidden`) and the word. */
export function markElement<E extends KitElement<E>>(doc: KitDocument<E>, mark: StatusMark): E {
  const glyph = attributes(element(doc, 'span', 'kit-mark__glyph', toneGlyph(mark.tone)), { 'aria-hidden': 'true' });

  return children(element(doc, 'span', `kit-mark kit-mark--${mark.tone}`), glyph, element(doc, 'span', 'kit-mark__word', mark.word));
}
