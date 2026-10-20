import { text } from './checks';
import { attributes, children, element, type KitDocument, type KitElement } from './dom';
import { checkedTone, toneGlyph, type StatusTone } from './status';

/**
 * `RecommendationCard` — what to do about the worst problem, and why (`research/PLAN_kit_components_storybook.md` §4.7).
 *
 * <p>A tone glyph (`aria-hidden`) and its WORD, one sentence, ONE button slot, and the evidence. Every word is the
 * consumer's. The slot holds the consumer's own button as given — the kit wires nothing on it, so the action is
 * the consumer's command and its own message — and anything that is not a `BUTTON` is refused: a card that
 * recommends an action offers exactly one way to take it.</p>
 */

export interface RecommendationOptions<E> {
  readonly tone: StatusTone;
  /** The tone's word — `Warning`, `All within limits` — so colour is never the only signal. */
  readonly word: string;
  readonly sentence: string;
  /** ONE element the consumer built, which must be a `BUTTON`. */
  readonly action?: E;
  readonly evidence?: readonly string[];
  /** The evidence list's label; `Evidence` when absent. */
  readonly evidenceLabel?: string;
}

const DEFAULT_EVIDENCE_LABEL = 'Evidence';

function checked<E extends KitElement<E>>(options: RecommendationOptions<E>): RecommendationOptions<E> {
  checkedTone(options.tone, 'RecommendationCard tone');
  text(options.word, 'RecommendationCard word');
  text(options.sentence, 'RecommendationCard sentence');
  if (options.action !== undefined && options.action.tagName !== 'BUTTON') {
    throw new TypeError(`RecommendationCard action must be a BUTTON element, got ${String(options.action.tagName)}.`);
  }
  (options.evidence ?? []).forEach((entry, index) => text(entry, `RecommendationCard evidence[${index}]`));

  return options;
}

/** The evidence: a label and a list, or nothing when there is none. */
function evidenceOf<E extends KitElement<E>>(doc: KitDocument<E>, options: RecommendationOptions<E>): E[] {
  const entries = options.evidence ?? [];
  if (entries.length === 0) {
    return [];
  }
  const label = element(doc, 'p', 'kit-rec__evidence-label', text(options.evidenceLabel ?? DEFAULT_EVIDENCE_LABEL, 'RecommendationCard evidenceLabel'));
  const items = entries.map((entry) => element(doc, 'li', 'kit-rec__evidence-item', entry));

  return [label, children(element(doc, 'ul', 'kit-rec__evidence'), ...items)];
}

export function createRecommendationCard<E extends KitElement<E>>(doc: KitDocument<E>, options: RecommendationOptions<E>): E {
  const spec = checked(options);
  const glyph = attributes(element(doc, 'span', 'kit-rec__glyph', toneGlyph(spec.tone)), { 'aria-hidden': 'true' });
  const head = children(element(doc, 'div', 'kit-rec__head'), glyph, element(doc, 'strong', 'kit-rec__word', spec.word));
  const card = children(element(doc, 'div', `kit-rec kit-rec--${spec.tone}`), head, element(doc, 'p', 'kit-rec__sentence', spec.sentence));
  if (spec.action !== undefined) {
    card.appendChild(children(element(doc, 'div', 'kit-rec__action'), spec.action));
  }

  return children(card, ...evidenceOf(doc, spec));
}
