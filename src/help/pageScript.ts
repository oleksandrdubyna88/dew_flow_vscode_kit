import type { DisplayConfig } from '../display/config';
import { toneScript } from '../display/tone';
import { zoomScript } from '../display/zoom';
import { jsonForScript } from '../webview/escape';

/**
 * The help page's script — the one `<script>` the page carries, under the page's nonce.
 *
 * <p>ConnectOtherAIs' `helpScript` at `1056aed9`, byte for byte, in three pieces so that no function here
 * is longer than the linter allows: the DATA the host renders in (the articles' markup, the search index,
 * the Home label — each through `jsonForScript`, never `JSON.stringify`, because an HTML parser ends a
 * script at `</script>` inside a string literal too), the ROUTING (index ↔ article as page state, so
 * Back is instant and the search box keeps its text), and the WIRING (the listeners). The two display
 * controls' scripts follow, as every page carries them.</p>
 *
 * <p>Tested by RUNNING it (`src/test/helpPageScript.test.ts`): a substring over this text cannot see a
 * control wired to the wrong branch.</p>
 */

/** What the host renders into the script: every article's markup by id, the search index, the Home label. */
export interface HelpScriptData {
  readonly articles: Readonly<Record<string, string>>;
  readonly index: readonly { readonly id: string; readonly title: string; readonly haystack: string }[];
  readonly home: string;
}

/** The elements the script holds, and the three state transitions: show the index, show an article, filter. */
const ROUTING = `  const indexEl = document.getElementById('index');
  const articleEl = document.getElementById('article');
  const crumbs = document.getElementById('crumbs');
  const back = document.getElementById('back');
  const searchRow = document.getElementById('searchRow');
  const noHits = document.getElementById('noHits');
  const search = document.getElementById('search');

  function showIndex() {
    articleEl.classList.add('hidden');
    indexEl.classList.remove('hidden');
    searchRow.classList.remove('hidden');
    back.classList.add('hidden');
    crumbs.innerHTML = '<a data-nav="home">' + HOME + '</a>';
    applyFilter();
  }
  function showArticle(id) {
    const html = ARTICLES[id];
    if (!html) { return; }
    const title = (INDEX.find((e) => e.id === id) || { title: id }).title;
    articleEl.innerHTML = html;
    articleEl.classList.remove('hidden');
    indexEl.classList.add('hidden');
    searchRow.classList.add('hidden');
    noHits.classList.add('hidden');
    back.classList.remove('hidden');
    crumbs.innerHTML = '<a data-nav="home">' + HOME + '</a> › <span>' + title.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]) + '</span>';
    window.scrollTo(0, 0);
  }
  function applyFilter() {
    const term = search.value.trim().toLowerCase();
    let shown = 0;
    for (const li of indexEl.querySelectorAll('li[data-open]')) {
      const entry = INDEX.find((e) => e.id === li.dataset.open);
      const hit = term === '' || (entry && entry.haystack.includes(term));
      li.classList.toggle('hidden', !hit);
      if (hit) { shown += 1; }
    }
    noHits.classList.toggle('hidden', shown > 0);
  }`;

/** The listeners: an index click opens an article, Home and Back and Escape return, the search filters, the language select posts. */
const WIRING = `  indexEl.addEventListener('click', (e) => {
    const li = e.target.closest('li[data-open]');
    if (li) { showArticle(li.dataset.open); }
  });
  document.addEventListener('click', (e) => {
    if (e.target.closest('[data-nav="home"]')) { showIndex(); }
  });
  back.addEventListener('click', showIndex);
  search.addEventListener('input', applyFilter);
  document.getElementById('language').addEventListener('change', (e) => {
    vscode.postMessage({ type: 'language', language: e.target.value, field: '' });
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !articleEl.classList.contains('hidden')) { showIndex(); }
  });`;

/** The whole `<script>` element, under `nonce`. */
export function helpScript(nonce: string, data: HelpScriptData, display: DisplayConfig): string {
  return `<script nonce="${nonce}">
  const vscode = acquireVsCodeApi();
  const ARTICLES = ${jsonForScript(data.articles)};
  const INDEX = ${jsonForScript(data.index)};
  const HOME = ${jsonForScript(data.home)};
${ROUTING}
${WIRING}
  ${zoomScript()}
  ${toneScript(display)}
</script>`;
}
