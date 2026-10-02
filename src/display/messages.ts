import type { DisplayConfig } from './config';
import type { TextToneMessage, UiScaleMessage } from './port';
import { toneColours, toneLabel } from './tone';
import { offsetLabel, scalePx } from './zoom';

/**
 * The two messages the host pushes to a page — the pure half of `host.ts`, so the shapes are a unit test
 * held against what ConnectOtherAIs' `uiScaleHost.ts:43` and `textToneHost.ts:51` posted at `1056aed9`.
 * The page scripts (`zoom.ts`, `tone.ts`) listen for exactly these.
 */

/** The size message for a CLAMPED offset: the root font size in px and the `+3` label. */
export function uiScaleMessage(offset: number): UiScaleMessage {
  return { type: 'uiScale', px: scalePx(offset), label: offsetLabel(offset) };
}

/**
 * The tone message for a CLAMPED offset. At zero every string is empty — an empty colour is the theme's
 * own, and assigning `''` is how the page gives the property back rather than painting over it.
 */
export function textToneMessage(offset: number, config: DisplayConfig): TextToneMessage {
  const { text, read } = toneColours(offset, config);

  return { type: 'textTone', color: text, read, label: toneLabel(offset) };
}
