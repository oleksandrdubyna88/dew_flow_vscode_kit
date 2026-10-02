import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createDisplayConfig } from '../display/config';
import { stampTranslations } from '../help/bootstrap';
import { createCatalog } from '../help/catalog';
import { articleHtml, renderHelpPage, type HelpAppendix } from '../help/page';
import { HELP_CHROME } from '../help/pageText';
import { TRANSLATED_LANGUAGES, type Catalog, type HelpLanguage } from '../help/types';
import { RECORDED_HELP_PAGE as PAGE } from './coaiFixture';
import { Node, runPageScript } from './pageHarness';

/**
 * The help page's script, RUN — taken from the page `renderHelpPage` actually renders, not assembled for
 * the test — against a DOM shaped as the page's markup shapes it: index ↔ article, Back, Escape, the
 * search with its `noHits` line, the language select's post, and the two display controls' posts.
 */

const COAI = createDisplayConfig('ConnectOtherAIs', 'coai');
const NONCE = 'b2JQb3ZlcnR5X3JhbmRvbQ';
const appendix: HelpAppendix = (id, language) => (id === PAGE.promptsArticle ? PAGE.appendix[language] : '');

function catalog(): Catalog {
  const unstamped = createCatalog({
    articles: PAGE.articles,
    translations: Object.fromEntries(TRANSLATED_LANGUAGES.map((language) => [language, { bodies: PAGE.translations[language], from: {} }])),
  });

  return createCatalog({ articles: PAGE.articles, translations: stampTranslations(unstamped) });
}

/** The page's own script, cut out of the rendered page. */
function scriptOf(html: string): string {
  const found = /<script nonce="[^"]*">([\s\S]*)<\/script>/.exec(html);
  assert.ok(found !== null, 'the page carries no script');

  return found[1] ?? '';
}

/** The page's elements, with the classes the markup gives them at first paint. */
function dom(ids: readonly string[]) {
  const index = new Node({}, 'UL');
  const items = Object.fromEntries(ids.map((id) => [id, new Node({ open: id }, 'LI').under(index)]));
  const crumbs = new Node({}, 'DIV');
  const home = new Node({ nav: 'home' }, 'A').under(crumbs);
  const back = new Node({}, 'BUTTON');
  back.className = 'secondary hidden';
  const noHits = new Node({}, 'P');
  noHits.className = 'empty hidden';
  const article = new Node({}, 'DIV');
  article.className = 'hidden';
  const smaller = new Node({ zoom: '-1' }, 'BUTTON');
  const larger = new Node({ zoom: '1' }, 'BUTTON');
  const dimmer = new Node({ tone: '-1' }, 'BUTTON');
  const brighter = new Node({ tone: '1' }, 'BUTTON');

  return {
    items, home, smaller, larger, dimmer, brighter,
    byId: {
      index, article, crumbs, back, noHits,
      searchRow: new Node({}, 'DIV'),
      search: new Node({}, 'INPUT'),
      language: new Node({}, 'SELECT'),
      zoomOffset: new Node({}, 'SPAN'),
      toneOffset: new Node({}, 'SPAN'),
    },
    bySelector: { 'button[data-zoom]': [smaller, larger], 'button[data-tone]': [dimmer, brighter] },
  };
}

function helpPage(language: HelpLanguage = 'en', extraItems: readonly string[] = []) {
  const made = catalog();
  const html = renderHelpPage({ catalog: made, language, display: COAI, nonce: NONCE, appendix });
  const elements = dom([...made.articles.map((article) => article.id), ...extraItems]);
  const page = runPageScript(scriptOf(html), elements.bySelector, elements.byId);

  return { catalog: made, html, page, ...elements, ...elements.byId };
}

const hidden = (node: Node): boolean => node.classList.contains('hidden');

test('at first paint the script posts nothing and changes nothing: the index is what the markup painted', () => {
  const { page, index, article, back, noHits } = helpPage();

  assert.deepEqual(page.posted, []);
  assert.equal(hidden(index), false);
  assert.equal(hidden(article), true);
  assert.equal(hidden(back), true);
  assert.equal(hidden(noHits), true);
});

test('clicking an index item opens that article — its markup, the crumbs with its title, Back shown, the index and search hidden, scrolled to the top', () => {
  const { catalog: made, page, items, index, article, back, searchRow, crumbs } = helpPage();

  items['gamma']?.click();

  assert.equal(article.innerHTML, articleHtml(made, 'gamma', 'en', appendix));
  assert.equal(hidden(article), false);
  assert.equal(hidden(index), true);
  assert.equal(hidden(searchRow), true);
  assert.equal(hidden(back), false);
  assert.equal(crumbs.innerHTML, '<a data-nav="home">Help</a> › <span>gamma en title &amp; &lt;more&gt;</span>');
  assert.deepEqual(page.scrolledTo, [[0, 0]]);
  assert.deepEqual(page.posted, [], 'navigation is page state, nothing is posted');
});

test('the prompts article carries the consumer\'s appendix when opened', () => {
  const { items, article } = helpPage();

  items[PAGE.promptsArticle]?.click();

  assert.ok(article.innerHTML.endsWith(`${PAGE.appendix.en}\n  </article>`));
});

test('Back returns to the index: the article hidden, the search and index shown, Back hidden, the crumbs just Home', () => {
  const { items, index, article, back, searchRow, crumbs } = helpPage();
  items['alpha']?.click();

  back.click();

  assert.equal(hidden(article), true);
  assert.equal(hidden(index), false);
  assert.equal(hidden(searchRow), false);
  assert.equal(hidden(back), true);
  assert.equal(crumbs.innerHTML, '<a data-nav="home">Help</a>');
});

test('the Home crumb returns to the index too, through the document\'s click listener', () => {
  const { items, home, index, article } = helpPage();
  items['alpha']?.click();
  assert.equal(hidden(article), false);

  home.click();

  assert.equal(hidden(article), true);
  assert.equal(hidden(index), false);
});

test('Escape returns to the index from an article, and does nothing on the index', () => {
  const { page, items, index, article, back } = helpPage();

  page.keydown('Escape');
  assert.equal(hidden(index), false);
  assert.equal(hidden(article), true);

  items['beta']?.click();
  page.keydown('a');
  assert.equal(hidden(article), false, 'another key must not navigate');
  page.keydown('Escape');
  assert.equal(hidden(article), true);
  assert.equal(hidden(index), false);
  assert.equal(hidden(back), true);
});

test('an index item whose id has no article leaves the page where it was', () => {
  const { items, index, article, back } = helpPage('en', ['nope']);

  items['nope']?.click();

  assert.equal(hidden(article), true);
  assert.equal(hidden(index), false);
  assert.equal(hidden(back), true);
  assert.equal(article.innerHTML, '');
});

test('the search hides the items that do not match, case-insensitively, over title and body in the shown language, and shows noHits when nothing matches', () => {
  const { items, search, noHits } = helpPage('ru');
  const shown = (): string[] => Object.entries(items).filter(([, li]) => !hidden(li)).map(([id]) => id);

  search.value = 'GAMMA EN';
  search.fire('input');
  assert.deepEqual(shown(), ['gamma'], 'gamma is the one article Russian does not translate, so its English is what is searched');
  assert.equal(hidden(noHits), true);

  search.value = ' alpha ru ';
  search.fire('input');
  assert.deepEqual(shown(), ['alpha']);

  search.value = 'zzz nothing has this';
  search.fire('input');
  assert.deepEqual(shown(), []);
  assert.equal(hidden(noHits), false, 'noHits must show when nothing matches');

  search.value = '';
  search.fire('input');
  assert.deepEqual(shown(), Object.keys(items));
  assert.equal(hidden(noHits), true);
});

test('coming back from an article re-applies the filter, so the search box keeps its text and its effect', () => {
  const { items, search, back, noHits } = helpPage();
  search.value = 'beta';
  search.fire('input');
  items['beta']?.click();

  back.click();

  assert.equal(hidden(items['beta'] as Node), false);
  assert.equal(hidden(items['alpha'] as Node), true);
  assert.equal(hidden(noHits), true);
});

test('choosing a language posts exactly the language message, with the empty field the kit\'s pages post', () => {
  const { page, language } = helpPage();

  language.value = 'uk';
  language.fire('change');

  assert.deepEqual(page.posted, [{ type: 'language', language: 'uk', field: '' }]);
});

test('the ± size and ± tone buttons post their presses from the help page as from every page', () => {
  const { page, smaller, larger, dimmer, brighter } = helpPage();

  larger.click();
  smaller.click();
  brighter.click();
  dimmer.click();

  assert.deepEqual(page.posted, [
    { type: 'zoom', delta: 1, field: '' },
    { type: 'zoom', delta: -1, field: '' },
    { type: 'tone', delta: 1, field: '' },
    { type: 'tone', delta: -1, field: '' },
  ]);
});

test('a pushed size and tone repaint the help page live', () => {
  const { page, zoomOffset, toneOffset } = helpPage();

  page.message({ type: 'uiScale', px: 15.73, label: '+2' });
  page.message({ type: 'textTone', color: 'color-mix(x)', read: 'color-mix(y)', label: '−1' });

  assert.equal(page.body.style.fontSize, '15.73px');
  assert.equal(zoomOffset.textContent, '+2');
  assert.equal(page.body.style.custom['--coai-text'], 'color-mix(x)');
  assert.equal(toneOffset.textContent, '−1');
});

test('the chrome the script paints is in the page\'s language', () => {
  const { items, crumbs } = helpPage('de');

  items['alpha']?.click();

  assert.ok(crumbs.innerHTML.startsWith(`<a data-nav="home">${HELP_CHROME.de.home}</a> › `));
});
