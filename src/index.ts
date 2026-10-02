/**
 * `@oleksandrdubyna88/vscode-webview-kit` — the public surface.
 *
 * <p>Filled in three steps of `todo/PLAN_extract_the_kit.md`: E2.S1 exported the display subsystem — the
 * ± text size and ± text tone controls' pure halves, their host behind the two ports, the press validator
 * — and the setting-write reporter the host reports through. E2.S2 adds the help CATALOG: its types, the
 * English digest, `bodyFor` with stale detection, the bootstrap and the two coverage checks a consumer's
 * suite asserts empty. E2.S3 adds the help page and panel, `text` and `webview`, and makes this the
 * whole 0.1.0 API.</p>
 *
 * <p>Nothing here imports `vscode`: a consumer adapts its own `vscode` objects to `ConfigurationPort` and
 * `WebviewPort` (the shape is in `display/port.ts`'s docblock) and bundles this package with esbuild.</p>
 */

// display — configuration
export { createDisplayConfig, isUsablePrefix, usablePrefix, type DisplayConfig } from './display/config';

// display — the ± text size, pure half
export {
  UI_SCALE_MAX,
  UI_SCALE_MIN,
  ZOOM_CSS,
  clampScale,
  offsetLabel,
  scalePx,
  zoomControlHtml,
  zoomScript,
  zoomStyle,
} from './display/zoom';

// display — the ± text tone, pure half
export {
  TEXT_TONE_MAX,
  TEXT_TONE_MIN,
  clampTone,
  toneColour,
  toneColours,
  toneControlHtml,
  toneCss,
  toneLabel,
  toneScript,
  toneStyle,
} from './display/tone';

// display — the host half, its ports, and the webview → host validation
export type {
  ConfigurationPort,
  Disposable,
  DisplayMessage,
  SettingName,
  TextToneMessage,
  UiScaleMessage,
  WebviewPort,
} from './display/port';
export { textToneMessage, uiScaleMessage } from './display/messages';
export { readPress, type Press, type PressKind, type PressReading, type PressRejection, type Step } from './display/press';
export {
  createDisplayHost,
  type DisplayHost,
  type DisplayHostOptions,
  type DisplayReporter,
  type DisplaySettings,
  type DisplayValues,
  type PushNotDelivered,
} from './display/host';

// settings — the "a view setting could not be saved" reporter the host reports through
export { settingWritten, type SettingNotSaved, type SettingReporter } from './settings/settingWritten';

// help — the catalog: articles, five languages, a visible fallback, and stale-translation detection
export {
  HELP_BODY_FIELDS,
  HELP_LANGUAGE_LABELS,
  HELP_LANGUAGES,
  TRANSLATED_LANGUAGES,
  type ArticleId,
  type Catalog,
  type Digest,
  type HelpArticle,
  type HelpBody,
  type HelpLanguage,
  type ShownBody,
  type Staleness,
  type TranslatedLanguage,
  type Translation,
  type Translations,
} from './help/types';
export { bodyFor, createCatalog, type CatalogInput } from './help/catalog';
export { canonicalForm, digestOf, isDigest } from './help/digest';
export { stampTranslations } from './help/bootstrap';
export {
  everyArticleInEveryLanguage,
  staleTranslations,
  type Coverage,
  type MissingTranslation,
  type StaleTranslation,
} from './help/coverage';
