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

/**
 * The one way to make a config: the prefix is checked HERE, because it reaches a stylesheet and a page
 * script unescaped — a prefix carrying `;}` or a quote would close a rule or a string (gate, epic 1 code
 * round, finding 6). A bad prefix is a consumer's programming error, so it throws.
 */
export function createDisplayConfig(product: string, cssPrefix: string): DisplayConfig {
  return { product, cssPrefix: usablePrefix(cssPrefix) };
}

/**
 * The prefix of a config, re-checked at the point of use — a plain object literal typed as a
 * `DisplayConfig` skips the factory, and the type cannot stop that at run time.
 */
export function usablePrefix(prefix: string): string {
  if (!isUsablePrefix(prefix)) {
    throw new TypeError(
      `CSS prefix ${JSON.stringify(prefix)} is not usable: it must be lowercase letters, digits and dashes, starting with a letter.`,
    );
  }

  return prefix;
}
