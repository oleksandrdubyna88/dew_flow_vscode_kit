import type { DisplayConfig } from '../display/config';
import { toneControlHtml, toneCss, toneStyle } from '../display/tone';
import { ZOOM_CSS, zoomControlHtml, zoomStyle } from '../display/zoom';
import { asText } from '../text/asText';
import { escapeHtml } from '../webview/escape';
import { bodyFor } from './catalog';
import { helpScript } from './pageScript';
import { HELP_CHROME, SECTION_LABELS, SECTION_ORDER, bodyHtml, noteHtml } from './pageText';
import { HELP_LANGUAGE_LABELS, type ArticleId, type Catalog, type HelpArticle, type HelpLanguage } from './types';

/**
 * The help page, as pure markup: the index in catalog order, one article view with breadcrumbs and
 * Back, a search box at the top centre, the language switch, and the ± text size and ± text tone every
 * page carries. Routing is client-side page STATE — index ↔ article — never a panel re-creation, so Back
 * is instant and the search box keeps its text.
 *
 * <p>Extracted from ConnectOtherAIs' `helpPage.ts` at `1056aed9` over a CATALOG, a display config and an
 * appendix hook instead of coai's module constants. For coai's configuration, the same nonce and the
 * same appendix, the page is byte-identical to what coai rendered — `src/test/helpPage.test.ts` holds it
 * against pages RECORDED from coai's own module. `vscode`-free and `node:`-free, like every page module:
 * the nonce is handed in by the host (`webview/nonce.ts` mints one per render), which is also what lets a
 * test render with a fixed one.</p>
 *
 * <p><b>Security of the page</b> (plan §1, gate round 1). The CSP is coai's, kept byte for byte:
 * `default-src 'none'` — no image, font, frame, connection or form reaches anywhere — `script-src` by the
 * per-render nonce on the page's ONE script, and `style-src 'unsafe-inline'` for the page's own
 * `<style>`, which carries only the kit's constants and two numeric values and never a consumer's or a
 * reader's text. There is no inline handler anywhere; every listener is bound in the script. Two things
 * are checked at the door, because both reach an attribute unescaped: the nonce must look like one (at
 * least 22 base64 characters — 128 bits, the CSP specification's floor), and the language must be one
 * the catalog offers. Article text is escaped before any markup of ours is added (`pageText.ts`); data
 * reaches the script through `jsonForScript` only (`pageScript.ts`); the appendix is the consumer's own
 * markup, inserted as is.</p>
 *
 * <p><b>What the kit adds</b>: the language switch lists only `catalog.languages` (English plus the
 * languages with a module — all five for coai), and a translation that `bodyFor` answers as `stale` or
 * `unknown` carries a note where the fallback note goes. A fresh catalog renders no note at all.</p>
 */

/**
 * At least 128 bits of base64 — the CSP specification's recommendation for a nonce — in either alphabet,
 * with or without padding. What `webview/nonce.ts` mints (16 bytes, base64url, 22 characters) passes; a
 * character that could end the attribute cannot.
 */
const NONCE_SHAPE = /^[A-Za-z0-9+/_-]{22,}={0,2}$/;

/** Markup a consumer appends to one article — coai's prompt listing under `prompts-in-full`. Already escaped by the consumer; inserted as is. */
export type HelpAppendix = (id: ArticleId, language: HelpLanguage) => string;

export interface HelpPageOptions {
  readonly catalog: Catalog;
  readonly language: HelpLanguage;
  readonly display: DisplayConfig;
  readonly nonce: string;
  readonly uiScale?: number;
  readonly textTone?: number;
  readonly appendix?: HelpAppendix;
}

/** One article as the page's search sees it: its id, its title in the shown language, and the lowercased text it matches on. */
export interface SearchEntry {
  readonly id: ArticleId;
  readonly title: string;
  readonly haystack: string;
}

const NO_APPENDIX: HelpAppendix = () => '';

/** The page's Content-Security-Policy for one render — coai's, with the nonce checked by the caller. */
export function helpCsp(nonce: string): string {
  return `default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';`;
}

/** The nonce, or a `TypeError` naming what a nonce is: it reaches two attributes unescaped. */
function usableNonce(nonce: string): string {
  if (!NONCE_SHAPE.test(nonce)) {
    throw new TypeError(`A CSP nonce is at least 22 base64 characters, as nonce() mints one; got ${JSON.stringify(nonce)}.`);
  }

  return nonce;
}

/** The language, or a `TypeError` naming the languages the catalog offers — the switch lists exactly those. */
function offeredLanguage(catalog: Catalog, language: HelpLanguage): HelpLanguage {
  if (!catalog.languages.includes(language)) {
    throw new TypeError(`This help catalog offers ${catalog.languages.join(', ')}; it cannot be shown in ${String(language)}.`);
  }

  return language;
}

/** What the page's search runs over — titles and bodies in the shown language, per article. */
export function searchIndex(catalog: Catalog, language: HelpLanguage): readonly SearchEntry[] {
  offeredLanguage(catalog, language);

  return catalog.articles.map((article) => {
    const { body } = bodyFor(catalog, article, language);

    return {
      id: article.id,
      title: body.title,
      haystack: [body.title, body.whatItIs, body.why, body.setup, body.usage, body.whatCanGoWrong].join(' ').toLowerCase(),
    };
  });
}

/** The article markup: the title, the note over it when there is one, five labelled sections in the fixed order, the appendix. Empty for an unknown id. */
export function articleHtml(catalog: Catalog, id: ArticleId, language: HelpLanguage, appendix: HelpAppendix = NO_APPENDIX): string {
  const article = catalog.articles.find((candidate) => candidate.id === id);

  return article === undefined ? '' : renderedArticle(catalog, article, offeredLanguage(catalog, language), appendix);
}

/**
 * One article's markup, for an article already in hand and a language already checked — what
 * {@link renderHelpPage} calls as it walks the catalog, so a render is one pass over the articles rather
 * than a search for each of them (gate, epic 2 code round, finding 7).
 */
function renderedArticle(catalog: Catalog, article: HelpArticle, language: HelpLanguage, appendix: HelpAppendix): string {
  const { id } = article;
  const shown = bodyFor(catalog, article, language);
  const labels = SECTION_LABELS[language];

  return `<article data-article="${escapeHtml(id)}">
    <h2>${escapeHtml(shown.body.title)}</h2>
    ${noteHtml(shown, language)}
    ${SECTION_ORDER.map((key) => `<h3>${escapeHtml(labels[key])}</h3>${bodyHtml(shown.body[key])}`).join('\n')}
    ${asText(appendix(id, language))}
  </article>`;
}

/**
 * The whole page for one render. Throws a `TypeError` for a nonce that is not one or a language the
 * catalog does not offer — both are a consumer's programming error, found at the first render.
 */
export function renderHelpPage(options: HelpPageOptions): string {
  const { catalog, display } = options;
  const nonce = usableNonce(options.nonce);
  const language = offeredLanguage(catalog, options.language);
  const uiScale = options.uiScale ?? 0;
  const textTone = options.textTone ?? 0;
  const appendix = options.appendix ?? NO_APPENDIX;
  const index = searchIndex(catalog, language);
  const articles = Object.fromEntries(catalog.articles.map((article) => [article.id, renderedArticle(catalog, article, language, appendix)]));

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy"
      content="${helpCsp(nonce)}">
<style>
${helpStyles(uiScale, textTone, display)}
</style>
</head>
<body>
${helpBody(catalog, language, uiScale, textTone, display)}
${helpScript(nonce, { articles, index, home: HELP_CHROME[language].home }, display)}
</body>
</html>`;
}

function helpStyles(uiScale: number, textTone: number, display: DisplayConfig): string {
  return `
  body { font-family: var(--vscode-font-family); color: var(--vscode-foreground);
         background: var(--vscode-editor-background); padding: 16px 24px; max-width: 900px;
         margin: 0 auto; ${zoomStyle(uiScale)} ${toneStyle(textTone, display)} }
  .topBar { display: flex; align-items: center; gap: 12px; margin-bottom: 14px; }
  .topBar .crumbs { flex: 1; min-width: 0; opacity: .8; }
  .crumbs a { cursor: pointer; text-decoration: underline; }
  .searchRow { display: flex; justify-content: center; margin: 4px 0 18px; }
  #search { width: min(520px, 100%); padding: 8px 12px; font-size: 1.05em;
            background: var(--vscode-input-background); color: var(--vscode-input-foreground);
            border: 1px solid var(--vscode-input-border, transparent); border-radius: 4px; }
  select { background: var(--vscode-dropdown-background); color: var(--vscode-dropdown-foreground);
           border: 1px solid var(--vscode-dropdown-border, transparent); padding: 4px 6px; }
  button { padding: 6px 14px; border: none; border-radius: 3px; cursor: pointer;
           background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
  button.secondary { background: var(--vscode-button-secondaryBackground);
                     color: var(--vscode-button-secondaryForeground);
                     border: 1px solid var(--vscode-button-border, var(--vscode-widget-border, #666)); }
  ul.index { list-style: none; padding: 0; margin: 0; }
  ul.index li { padding: 10px 12px; border: 1px solid var(--vscode-widget-border, #3c3c3c);
                border-radius: 4px; margin-bottom: 8px; cursor: pointer; }
  ul.index li:hover { background: var(--vscode-list-hoverBackground); }
  ul.index li .lead { opacity: .75; font-size: .92em; margin-top: 3px; }
  article h2 { margin: 0 0 6px; }
  article h3 { margin: 18px 0 4px; font-size: 1em; opacity: .85; text-transform: uppercase;
               letter-spacing: .06em; }
  article p { margin: 0; line-height: 1.5; }
  .fallback { color: var(--vscode-editorWarning-foreground, #cca700); font-style: italic; }
  .hidden { display: none; }
  .empty { opacity: .7; font-style: italic; }
  .promptBlock { margin: 10px 0 18px; }
  .promptId { font-family: var(--vscode-editor-font-family); opacity: .7; margin-bottom: 4px; }
  pre.prompt { white-space: pre-wrap; overflow-x: auto; padding: 10px 12px; margin: 0;
               background: var(--vscode-textCodeBlock-background, rgba(127,127,127,.12));
               border: 1px solid var(--vscode-widget-border, #3c3c3c); border-radius: 4px;
               font-family: var(--vscode-editor-font-family); font-size: .92em; }
  ${ZOOM_CSS}
  ${toneCss(display)}
`;
}

function helpBody(catalog: Catalog, language: HelpLanguage, uiScale: number, textTone: number, display: DisplayConfig): string {
  const chrome = HELP_CHROME[language];

  return `
  <div class="topBar">
    <div class="crumbs" id="crumbs"><a data-nav="home">${escapeHtml(chrome.home)}</a></div>
    <button type="button" id="back" class="secondary hidden">${escapeHtml(chrome.back)}</button>
    <select id="language" aria-label="Help language">${catalog.languages.map(
      (code) => `<option value="${code}"${code === language ? ' selected' : ''}>${escapeHtml(HELP_LANGUAGE_LABELS[code])}</option>`,
    ).join('')}</select>
    ${zoomControlHtml(uiScale, display)}${toneControlHtml(textTone, display)}
  </div>
  <div class="searchRow" id="searchRow">
    <input id="search" type="search" placeholder="${escapeHtml(chrome.search)}" autofocus>
  </div>
  <ul class="index" id="index">
    ${catalog.articles.map((article) => indexItem(catalog, article, language)).join('\n    ')}
  </ul>
  <p id="noHits" class="empty hidden">${escapeHtml(chrome.noHits)}</p>
  <div id="article" class="hidden"></div>
`;
}

/** One index entry: the title in the shown language, and its "what it is" as the line under it. */
function indexItem(catalog: Catalog, article: HelpArticle, language: HelpLanguage): string {
  const { body } = bodyFor(catalog, article, language);

  return `<li data-open="${escapeHtml(article.id)}"><div class="title">${escapeHtml(body.title)}</div>
      <div class="lead">${escapeHtml(body.whatItIs)}</div></li>`;
}
