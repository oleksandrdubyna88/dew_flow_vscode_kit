import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createDisplayConfig } from '../display/config';
import { stampTranslations } from '../help/bootstrap';
import { bodyFor, createCatalog } from '../help/catalog';
import { articleHtml, helpCsp, renderHelpPage, searchIndex, type HelpAppendix } from '../help/page';
import { HELP_CHROME, bodyHtml } from '../help/pageText';
import { HELP_LANGUAGES, TRANSLATED_LANGUAGES, type Catalog, type HelpArticle, type HelpLanguage, type Translations } from '../help/types';
import { RECORDED_HELP_PAGE as PAGE } from './coaiFixture';
import { assertNoCr } from './lineEndings';

/**
 * The help page: for ConnectOtherAIs' configuration, the same nonce and the same appendix, the kit's
 * `renderHelpPage` returns the BYTES coai's `renderHelpHtml` returned at `1056aed9` — recorded from coai's
 * own module by `scripts/record-coai-help-page.mjs`, never retyped (plan §1 item 2). Then what the kit
 * adds on top of that page: the nonce and the language are checked at the door, the language switch
 * lists only what the catalog offers, and a translation not made from the current English carries a
 * note — which renders NOTHING for a fresh catalog, so byte-compatibility holds for coai's bootstrapped
 * one. Every rendered fragment is CR-free.
 */

const COAI = createDisplayConfig('ConnectOtherAIs', 'coai');
const NONCE = 'b2JQb3ZlcnR5X3JhbmRvbQ';

/** The recorded modules, with no `from` — as coai's are before its switch. */
function unstampedTranslations(): Translations {
  return Object.fromEntries(TRANSLATED_LANGUAGES.map((language) => [language, { bodies: PAGE.translations[language], from: {} }]));
}

/** The recorded synthetic input as a kit catalog, every translation stamped fresh — as coai's are after its switch. */
function coaiLikeCatalog(articles: readonly HelpArticle[] = PAGE.articles): Catalog {
  const unstamped = createCatalog({ articles: PAGE.articles, translations: unstampedTranslations() });

  return createCatalog({ articles, translations: stampTranslations(unstamped) });
}

/** coai's own appendix for the prompts article, recovered from its output, and nothing for any other. */
const appendix: HelpAppendix = (id, language) => (id === PAGE.promptsArticle ? PAGE.appendix[language] : '');

/** The one `<script>` of a rendered page. */
function scriptOf(html: string): string {
  const found = /<script nonce="[^"]*">([\s\S]*)<\/script>/.exec(html);
  assert.ok(found !== null, 'the page carries no script');

  return found[1] ?? '';
}

// ---------------------------------------------------------------------------------------------------
// Byte-compatibility with coai
// ---------------------------------------------------------------------------------------------------

test('the fixture is coai\'s own help page at 1056aed9, over every language, with a nonce read back from each page', () => {
  assert.match(PAGE.source, /1056aed9/);
  assert.match(PAGE.source, /helpPage\.ts/);
  assert.deepEqual(PAGE.languages, [...HELP_LANGUAGES]);
  assert.deepEqual([...new Set(PAGE.pages.map((page) => page.language))].sort(), [...HELP_LANGUAGES].sort());
  for (const page of PAGE.pages) {
    assert.match(page.nonce, /^[A-Za-z0-9_-]{22}$/, 'coai minted 16 random bytes as base64url');
    assert.ok(page.html.includes(`'nonce-${page.nonce}'`) && page.html.includes(`<script nonce="${page.nonce}">`));
  }
  assert.ok(PAGE.pages.some((page) => page.uiScale !== undefined && page.uiScale !== 0), 'no page at an off-centre size');
});

for (const page of PAGE.pages) {
  test(`the ${page.language} page at size ${page.uiScale ?? 0}, tone ${page.textTone ?? 0} is byte-identical to coai's, given its nonce and appendix`, () => {
    const options = {
      catalog: coaiLikeCatalog(),
      language: page.language,
      display: COAI,
      nonce: page.nonce,
      appendix,
      ...(page.uiScale === undefined ? {} : { uiScale: page.uiScale }),
      ...(page.textTone === undefined ? {} : { textTone: page.textTone }),
    };
    const html = renderHelpPage(options);

    assertNoCr(html, `the ${page.language} page`);
    assert.equal(html, page.html);
  });
}

for (const language of HELP_LANGUAGES) {
  test(`the ${language} search index and every article's markup are byte-identical to coai's`, () => {
    const catalog = coaiLikeCatalog();

    assert.deepEqual(searchIndex(catalog, language), PAGE.searchIndex[language]);
    for (const article of PAGE.articles) {
      const html = articleHtml(catalog, article.id, language, appendix);
      assertNoCr(html, `${article.id}/${language}`);
      assert.equal(html, PAGE.articleHtml[language]?.[article.id]);
    }
  });
}

test('bodyHtml renders every recorded sample as coai did — paragraphs, bullets, emphasis, escaping, a CRLF body folded as coai folded it', () => {
  assert.ok(PAGE.bodyHtml.length >= 10);
  for (const sample of PAGE.bodyHtml) {
    const html = bodyHtml(sample.text);
    assertNoCr(html, `bodyHtml(${JSON.stringify(sample.text)})`);
    assert.equal(html, sample.html);
  }
});

test('the comparison depends on what it is given: another nonce, another appendix, or another display config is not coai\'s page', () => {
  const page = PAGE.pages[0];
  assert.ok(page !== undefined);
  const options = { catalog: coaiLikeCatalog(), language: page.language, display: COAI, nonce: page.nonce, appendix };

  assert.equal(renderHelpPage(options), page.html);
  assert.notEqual(renderHelpPage({ ...options, nonce: NONCE }), page.html);
  assert.notEqual(renderHelpPage({ ...options, appendix: () => '' }), page.html);
  assert.notEqual(renderHelpPage({ ...options, display: createDisplayConfig('WSL Care', 'wslcare') }), page.html);
});

test('an unknown article id renders nothing, as coai\'s did', () => {
  assert.equal(articleHtml(coaiLikeCatalog(), 'nope', 'en', appendix), '');
});

// ---------------------------------------------------------------------------------------------------
// The CSP and the nonce
// ---------------------------------------------------------------------------------------------------

test('the page carries a CSP of default-src none with the nonce on its one script, and no inline handler anywhere', () => {
  const html = renderHelpPage({ catalog: coaiLikeCatalog(), language: 'en', display: COAI, nonce: NONCE, appendix });

  assert.ok(html.includes(`<meta http-equiv="Content-Security-Policy"\n      content="${helpCsp(NONCE)}">`));
  assert.match(helpCsp(NONCE), /^default-src 'none'; /);
  assert.ok(helpCsp(NONCE).includes(`script-src 'nonce-${NONCE}'`));
  assert.equal((html.match(/<script\b/g) ?? []).length, 1, 'exactly one script element');
  assert.ok(html.includes(`<script nonce="${NONCE}">`));
  assert.equal(/\son[a-z]+=/i.test(html), false, 'an inline event handler attribute');
  assert.equal(/javascript:/i.test(html), false);
  assert.equal((html.match(/<style\b/g) ?? []).length, 1);
});

const BAD_NONCES: readonly string[] = ['', 'n', 'short', 'abc"def"ghijklmnopqrstu', "x' y zabcdefghijklmnopqr", '<script>abcdefghijklmnopq', 'abcdefghijklmnopqrstuvwxyz;', 'abc defghijklmnopqrstuvw'];

for (const bad of BAD_NONCES) {
  test(`a nonce that is not at least 22 base64 characters is refused at the door: ${JSON.stringify(bad)}`, () => {
    assert.throws(() => renderHelpPage({ catalog: coaiLikeCatalog(), language: 'en', display: COAI, nonce: bad }), /nonce/);
  });
}

test('a standard-base64 nonce with padding and a longer base64url one are both accepted', () => {
  for (const good of ['AAECAwQFBgcICQoLDA0ODw==', 'abcdefghijklmnopqrstuvwxyz0123456789-_AB']) {
    const html = renderHelpPage({ catalog: coaiLikeCatalog(), language: 'en', display: COAI, nonce: good });
    assert.ok(html.includes(`'nonce-${good}'`));
  }
});

// ---------------------------------------------------------------------------------------------------
// The languages: only what the catalog offers
// ---------------------------------------------------------------------------------------------------

/** A catalog whose only translation module is Russian. */
function ruOnly(): Catalog {
  return createCatalog({ articles: PAGE.articles, translations: { ru: stampTranslations(coaiLikeCatalog()).ru ?? { bodies: {}, from: {} } } });
}

test('the language switch lists English and the languages with a module — and only those — with the shown one selected', () => {
  const html = renderHelpPage({ catalog: ruOnly(), language: 'ru', display: COAI, nonce: NONCE });

  assert.ok(html.includes('<select id="language" aria-label="Help language"><option value="en">English</option><option value="ru" selected>Русский</option></select>'));
  assert.equal(html.includes('value="de"'), false);
});

test('a language the catalog does not offer is refused, naming what it does offer — the page, the index and an article alike', () => {
  const catalog = ruOnly();

  assert.throws(() => renderHelpPage({ catalog, language: 'de', display: COAI, nonce: NONCE }), /offers en, ru/);
  assert.throws(() => searchIndex(catalog, 'de'), /offers en, ru/);
  assert.throws(() => articleHtml(catalog, 'alpha', 'de'), /offers en, ru/);
});

// ---------------------------------------------------------------------------------------------------
// The stale note — new, and silent for a fresh catalog
// ---------------------------------------------------------------------------------------------------

/** The catalog with one English body rewritten after its translations were made. */
function withEditedEnglish(id: string): Catalog {
  const fresh = coaiLikeCatalog();
  const articles = fresh.articles.map((article) => (article.id === id ? { id, en: { ...article.en, usage: `${article.en.usage} Rewritten.` } } : article));

  return createCatalog({ articles, translations: fresh.translations });
}

const staleNote = (language: HelpLanguage): string => `<p class="fallback stale">${HELP_CHROME[language].stale}</p>`;

test('every language has a stale note of its own, different from its fallback note', () => {
  for (const language of HELP_LANGUAGES) {
    const chrome = HELP_CHROME[language];
    assert.ok(chrome.stale.length > 0, language);
    assert.notEqual(chrome.stale, chrome.fallback, language);
  }
});

test('a fresh catalog renders no stale note anywhere — which is what keeps coai\'s page byte-identical', () => {
  const catalog = coaiLikeCatalog();
  for (const language of HELP_LANGUAGES) {
    for (const article of catalog.articles) {
      assert.equal(articleHtml(catalog, article.id, language).includes('stale'), false, `${article.id}/${language}`);
    }
    assert.equal(renderHelpPage({ catalog, language, display: COAI, nonce: NONCE }).includes('class="fallback stale"'), false, language);
  }
});

test('an English edit puts the stale note over exactly that article\'s translations, where the fallback note would go; English and a fallback carry none', () => {
  const catalog = withEditedEnglish('beta');

  const ruBeta = articleHtml(catalog, 'beta', 'ru');
  assert.ok(ruBeta.includes(`</h2>\n    ${staleNote('ru')}\n    <h3>`), ruBeta);
  assert.ok(articleHtml(catalog, 'beta', 'es').includes(staleNote('es')));
  assert.equal(articleHtml(catalog, 'beta', 'en').includes('stale'), false, 'English is what changed, not stale');
  assert.equal(articleHtml(catalog, 'alpha', 'ru').includes('stale'), false, 'an untouched article');
  // uk has no beta: the English fallback is shown, with the fallback note — the current English is not stale.
  assert.equal(bodyFor(catalog, catalog.articles[1] as HelpArticle, 'uk').fallback, true);
  assert.ok(articleHtml(catalog, 'beta', 'uk').includes(`<p class="fallback">${HELP_CHROME.uk.fallback}</p>`));
  assert.equal(articleHtml(catalog, 'beta', 'uk').includes('stale'), false);
});

test('a translation with no from entry is unknown, and wears the same note — never passed as fresh to a reader', () => {
  const catalog = createCatalog({ articles: PAGE.articles, translations: unstampedTranslations() });

  assert.ok(articleHtml(catalog, 'alpha', 'ru').includes(staleNote('ru')));
  assert.ok(articleHtml(catalog, 'alpha', 'uk').includes(staleNote('uk')));
  assert.equal(articleHtml(catalog, 'alpha', 'en').includes('stale'), false);
});

test('the stale note reaches the page: the article markup the script carries has it, and the stylesheet is unchanged', () => {
  const fresh = renderHelpPage({ catalog: coaiLikeCatalog(), language: 'ru', display: COAI, nonce: NONCE, appendix });
  const stale = renderHelpPage({ catalog: withEditedEnglish('beta'), language: 'ru', display: COAI, nonce: NONCE, appendix });

  assert.notEqual(stale, fresh);
  assert.equal(stale.slice(0, stale.indexOf('<body>')), fresh.slice(0, fresh.indexOf('<body>')), 'the head, stylesheet included, must not change');
  assert.ok(scriptOf(stale).includes('fallback stale'));
  assert.equal(scriptOf(fresh).includes('fallback stale'), false);
});

// ---------------------------------------------------------------------------------------------------
// Another consumer
// ---------------------------------------------------------------------------------------------------

test('another consumer gets its own product name and CSS prefix in the page, and nothing of coai', () => {
  const mine = createDisplayConfig('WSL Care', 'wslcare');
  const html = renderHelpPage({ catalog: coaiLikeCatalog(), language: 'en', display: mine, nonce: NONCE, uiScale: 1, textTone: 2 });

  assert.ok(html.includes('every WSL Care page'));
  assert.ok(html.includes('--wslcare-text'));
  assert.equal(/coai|ConnectOtherAIs/.test(html), false, 'coai leaked into another consumer\'s page');
  assertNoCr(html, 'the WSL Care page');
});
