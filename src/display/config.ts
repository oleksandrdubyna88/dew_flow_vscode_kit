/**
 * What a consumer tells the display controls about itself.
 *
 * <p>The only two things ConnectOtherAIs had hard-coded into otherwise generic markup: the product name in
 * the tooltips ("applies to every ConnectOtherAIs page") and the prefix of the CSS custom properties the
 * tone writes (`--coai-text`). With `{ product: 'ConnectOtherAIs', cssPrefix: 'coai' }` every function here
 * returns exactly what coai rendered at `1056aed9` — which `zoomByteCompat`/`toneByteCompat` pin.</p>
 */
export interface DisplayConfig {
  /** Shown in the controls' tooltips: "applies to every <product> page". */
  readonly product: string;
  /** The CSS custom-property prefix, without dashes: `coai` → `--coai-text`. Lowercase letters/digits. */
  readonly cssPrefix: string;
}

/** A prefix is only safe inside a property name when it is plain lowercase letters, digits and dashes. */
export function isUsablePrefix(prefix: string): boolean {
  return /^[a-z][a-z0-9-]*$/.test(prefix);
}
