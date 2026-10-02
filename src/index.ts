/**
 * `@oleksandrdubyna88/vscode-webview-kit` — the public surface, whole as of 0.1.0.
 *
 * <p>Filled in three steps of `todo/PLAN_extract_the_kit.md`: E2.S1 exported the display subsystem — the
 * ± text size and ± text tone controls' pure halves, their host behind the two ports, the press validator
 * — and the setting-write reporter the host reports through. E2.S2 added the help CATALOG: its types, the
 * English digest, `bodyFor` with stale detection, the bootstrap and the two coverage checks a consumer's
 * suite asserts empty. E2.S3 adds the help PAGE and PANEL with their message reader, and the `text` and
 * `webview` helpers a consumer's own pages share with the kit's. `src/test/exports.test.ts` pins this
 * list — a name added or dropped here is a red test.</p>
 *
 * <p>Nothing here imports `vscode`: a consumer adapts its own `vscode` objects to `ConfigurationPort`,
 * `WebviewPort` and `HelpPanelPort` (the shapes are in `display/port.ts`'s and `help/panel.ts`'s
 * docblocks, and in the README) and bundles this package with esbuild. Not exported, on purpose: the help
 * page's own chrome strings and section labels, the page script's pieces, the shared own-member reader,
 * SHA-256 — internals a consumer has no call for, kept private so they can change.</p>
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

// settings — the "a view setting could not be saved" reporter the hosts report through
export { settingWritten, type SettingNotSaved, type SettingReporter } from './settings/settingWritten';

// text — text, whatever the caller actually had
export { asText } from './text/asText';

// webview — the escapers every page needs, the per-render nonce, the ordered write queue
export { escapeHtml, escapeHtmlForHighlighting, jsonForScript } from './webview/escape';
export { nonce } from './webview/nonce';
export { WriteQueue } from './webview/writeQueue';

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

// help — the page (pure, nonce injected), its message reader, and the panel behind its port
export { articleHtml, helpCsp, renderHelpPage, searchIndex, type HelpAppendix, type HelpPageOptions, type SearchEntry } from './help/page';
export { bodyHtml } from './help/pageText';
export { readHelpMessage, type HelpAction, type HelpMessageReading, type HelpMessageRejection } from './help/messages';
export { createHelpPanel, type HelpPanel, type HelpPanelOptions, type HelpPanelPort } from './help/panel';
