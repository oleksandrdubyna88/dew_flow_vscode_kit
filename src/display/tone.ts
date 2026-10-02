import { escapeHtml } from '../webview/escape';
import type { DisplayConfig } from './config';

/**
 * The ± tone of the text, beside the ± size of it — the pure half.
 *
 * <p>Extracted from ConnectOtherAIs (`src_vs_code/src/textTone.ts` at `1056aed9`). Asked for as "brighter
 * — yellower — greyer": the theme's white is the only white a page has, and on a long answer at night it
 * is too bright. <b>One axis, and zero is the theme</b> — at `0` nothing is emitted at all. Positive steps
 * push the text AWAY from the background; negative steps pull it towards a warm grey, which dims and warms
 * at once. Which way is "away" depends on the theme: VS Code's own `vscode-light` body class flips the
 * target to black, so "brighter" never means "invisible" on a light theme.</p>
 *
 * <p>It does not borrow the zoom's clamp even though the range matches today: two settings that happen to
 * share a range are not one setting.</p>
 */

export const TEXT_TONE_MIN = -5;
export const TEXT_TONE_MAX = 5;

/** How much of the target is mixed in per step. Five steps is 40%: a change, never a new colour. */
const MIX_PER_STEP = 8;

/** The colour a NEGATIVE step pulls towards: warm, and darker than any theme's foreground. */
const WARM = '#b9a88a';

/** The setting's value, made safe: clamped to the range, truncated to an integer, 0 for junk. */
export function clampTone(value: unknown): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : 0;

  return Math.min(TEXT_TONE_MAX, Math.max(TEXT_TONE_MIN, n));
}

/** `+3` / `−3`, and empty at the theme's own colour. */
export function toneLabel(offset: number): string {
  const clamped = clampTone(offset);
  if (clamped === 0) {
    return '';
  }

  return clamped > 0 ? `+${clamped}` : `−${-clamped}`;
}

/**
 * The colour for an offset, as a CSS value — or nothing at all at the theme's own colour.
 *
 * <p>`color-mix` resolves its `var()`s where it is USED, so the same string works in a stylesheet at
 * render time and in `body.style` later from a pushed message.</p>
 */
export function toneColour(offset: number, config: DisplayConfig, base = 'var(--vscode-foreground)'): string {
  const clamped = clampTone(offset);
  if (clamped === 0) {
    return '';
  }
  const mixed = Math.abs(clamped) * MIX_PER_STEP;
  const target = clamped > 0 ? `var(--${config.cssPrefix}-tone-away)` : `var(--${config.cssPrefix}-tone-warm)`;

  return `color-mix(in srgb, ${base} ${100 - mixed}%, ${target} ${mixed}%)`;
}

/**
 * The two colours a page paints with, toned: its own chrome, and the text it is there to show — which
 * may set `--vscode-editor-foreground` for itself and so would not inherit a tone applied to `body` alone.
 */
export function toneColours(offset: number, config: DisplayConfig): { readonly text: string; readonly read: string } {
  return {
    text: toneColour(offset, config),
    read: toneColour(offset, config, 'var(--vscode-editor-foreground)'),
  };
}

/**
 * The CSS fragment for the INSIDE of the page's own `body {}` rule — empty at zero, so an untouched
 * control leaves the rule exactly as it was.
 */
export function toneStyle(offset: number, config: DisplayConfig): string {
  const { text, read } = toneColours(offset, config);
  const p = config.cssPrefix;

  return text.length === 0 ? '' : `--${p}-text: ${text}; --${p}-read: ${read}; color: var(--${p}-text);`;
}

/** The header control: minus, the offset, plus. The zoom's shape, its own field. */
export function toneControlHtml(offset: number, config: DisplayConfig): string {
  return `<span class="toneCtl" title="Text tone: brighter, or dimmer and warmer (every ${escapeHtml(config.product)} page)">
    <span class="ctlIcon" aria-hidden="true">☀</span>
    <button type="button" class="icon" data-tone="-1" aria-label="Dimmer, warmer text">−</button>
    <span id="toneOffset" class="zoomOffset">${escapeHtml(toneLabel(offset))}</span>
    <button type="button" class="icon" data-tone="1" aria-label="Brighter text">+</button>
  </span>`;
}

/**
 * The webview-side wiring, as a script fragment: post the press, apply pushed values live. Its own
 * `data-tone` attribute and `toneOffset` id — sharing the zoom's would cross-wire the two controls.
 */
export function toneScript(config: DisplayConfig, handle = 'vscode'): string {
  const p = config.cssPrefix;

  return `
  for (const toneButton of document.querySelectorAll('button[data-tone]')) {
    toneButton.addEventListener('click', () => {
      ${handle}.postMessage({ type: 'tone', delta: Number(toneButton.dataset.tone), field: '' });
    });
  }
  window.addEventListener('message', (event) => {
    if (event.data?.type !== 'textTone') { return; }
    // BOTH, for the same reason the stylesheet writes both: the transcript names its own colour and
    // would keep it through every press otherwise.
    document.body.style.setProperty('--${p}-text', event.data.color);
    document.body.style.setProperty('--${p}-read', event.data.read);
    document.body.style.color = event.data.color.length > 0 ? 'var(--${p}-text)' : '';
    const toneLabelNode = document.getElementById('toneOffset');
    if (toneLabelNode) { toneLabelNode.textContent = event.data.label; }
  });`;
}

/** Shared look for the control, and the two direction targets — defaults on the ROOT so a page can override. */
export function toneCss(config: DisplayConfig): string {
  const p = config.cssPrefix;

  return `
  /* The defaults sit on the ROOT so a page's own body rule can override them: a declaration on the
     element beats one it merely inherits, whichever order the two rules are written in. */
  :root { --${p}-text: var(--vscode-foreground); --${p}-read: var(--vscode-editor-foreground); }
  body { --${p}-tone-away: #ffffff; --${p}-tone-warm: ${WARM}; }
  body.vscode-light { --${p}-tone-away: #000000; }
  .toneCtl { display: inline-flex; align-items: center; gap: 2px; margin-left: 6px; }
  .toneCtl button { min-width: 24px; padding: 2px 6px; }`;
}
