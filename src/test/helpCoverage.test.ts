import assert from 'node:assert/strict';
import { test } from 'node:test';

import { stampTranslations } from '../help/bootstrap';
import { bodyFor, createCatalog, type CatalogInput } from '../help/catalog';
import { everyArticleInEveryLanguage, staleTranslations } from '../help/coverage';
import { digestOf } from '../help/digest';
import { TRANSLATED_LANGUAGES, type HelpArticle, type HelpBody, type Translation } from '../help/types';
import { RECORDED_HELP } from './coaiFixture';

/**
 * What a CONSUMER's own suite calls (epic 2 plan round, finding 0): a stale translation is the intended
 * signal, not a defect — but an English edit committed without its translations must fail the consumer's
 * CI rather than reach a reader. So `staleTranslations(catalog)` lists every translated body that is
 * `stale` or `unknown`, a consumer asserts it empty, and `help-digests` prints the replacement `from`
 * line for each. `stampTranslations` is the one-time bootstrap of a catalog whose modules have no `from`
 * yet; `everyArticleInEveryLanguage` is coai's "every article exists in every language" check, moved.
 *
 * Every digest below is read back from `digestOf`; none is typed.
 */

const body = (tag: string): HelpBody => ({
  title: `${tag} title`,
  whatItIs: `${tag} what it is`,
  why: `${tag} why`,
  setup: `${tag} setup`,
  usage: `${tag} usage`,
  whatCanGoWrong: `${tag} what can go wrong`,
});

const article = (id: string): HelpArticle => ({ id, en: body(`${id} en`) });

const ALPHA = article('alpha');
const BETA = article('beta');
const GAMMA = article('gamma');
const ARTICLES: readonly HelpArticle[] = [ALPHA, BETA, GAMMA];

/** Bodies for the given ids, with NO `from` — a translation module as coai's are before the switch. */
const unstamped = (language: string, ids: readonly string[]): Translation => ({
  bodies: Object.fromEntries(ids.map((id) => [id, body(`${id} ${language}`)])),
  from: {},
});

/** ru all three, uk alpha and beta, de alpha only; es has no module. Nothing stamped. */
function beforeTheSwitch(): CatalogInput {
  return {
    articles: ARTICLES,
    translations: {
      ru: unstamped('ru', ['alpha', 'beta', 'gamma']),
      uk: unstamped('uk', ['alpha', 'beta']),
      de: unstamped('de', ['alpha']),
    },
  };
}

/** The bootstrap, as the coai switch runs it once: stamp, then build the catalog from what came back. */
function bootstrapped(input: CatalogInput = beforeTheSwitch()) {
  return createCatalog({ articles: input.articles, translations: stampTranslations(createCatalog(input)) });
}

// ---------- the bootstrap ----------

test('before the bootstrap every translated body is unknown, and staleTranslations says so', () => {
  const catalog = createCatalog(beforeTheSwitch());

  assert.equal(staleTranslations(catalog).length, 6);
  assert.ok(staleTranslations(catalog).every((entry) => entry.stale === 'unknown' && entry.from === null));
});

test('after the bootstrap nothing is stale: staleTranslations is empty and every bodyFor is fresh', () => {
  const catalog = bootstrapped();

  assert.deepEqual(staleTranslations(catalog), []);
  for (const a of catalog.articles) {
    for (const language of catalog.languages) {
      assert.equal(bodyFor(catalog, a, language).stale, 'fresh', `${a.id}/${language}`);
    }
  }
});

test('the bootstrap stamps each translated body with its English digest — and only the bodies it has', () => {
  const stamped = stampTranslations(createCatalog(beforeTheSwitch()));

  assert.deepEqual(Object.keys(stamped), ['ru', 'uk', 'de']);
  assert.deepEqual(stamped.ru?.from, { alpha: digestOf(ALPHA.en), beta: digestOf(BETA.en), gamma: digestOf(GAMMA.en) });
  assert.deepEqual(stamped.uk?.from, { alpha: digestOf(ALPHA.en), beta: digestOf(BETA.en) });
  assert.deepEqual(stamped.de?.from, { alpha: digestOf(ALPHA.en) });
  assert.deepEqual(stamped.ru?.bodies, beforeTheSwitch().translations.ru?.bodies);
});

test('the bootstrap overwrites a from that was stale: it asserts the translations match TODAY’s English', () => {
  // The stated assumption of plan §2 — which is why it is a one-time step and not something a build runs.
  const old = createCatalog(bootstrapped());
  const editedAlpha: HelpArticle = { id: 'alpha', en: body('alpha en, rewritten') };
  const edited = createCatalog({ articles: [editedAlpha, BETA, GAMMA], translations: old.translations });
  assert.equal(staleTranslations(edited).length, 3);

  assert.deepEqual(staleTranslations(bootstrapped(edited)), []);
});

test('the bootstrap returns NEW translation objects and never writes the catalog or its input', () => {
  const input = beforeTheSwitch();
  const frozen: CatalogInput = Object.freeze({
    articles: Object.freeze([...input.articles]),
    translations: Object.freeze(
      Object.fromEntries(
        Object.entries(input.translations).map(([language, t]) => [language, Object.freeze({ bodies: Object.freeze({ ...t.bodies }), from: Object.freeze({}) })]),
      ),
    ),
  });
  const before = structuredClone(frozen);
  const catalog = createCatalog(frozen);

  const stamped = stampTranslations(catalog);

  assert.deepEqual(frozen, before);
  for (const language of TRANSLATED_LANGUAGES.filter((l) => catalog.translations[l] !== undefined)) {
    assert.notEqual(stamped[language], catalog.translations[language], `${language}: the module itself was handed back`);
    assert.notEqual(stamped[language]?.from, catalog.translations[language]?.from, `${language}: the from map itself was handed back`);
    assert.deepEqual(catalog.translations[language]?.from, {}, `${language}: the catalog's own from map was written`);
  }
});

// ---------- staleTranslations: the consumer's CI check ----------

test('an English edit lists exactly that article, in every language that has it, with the from to replace', () => {
  const old = bootstrapped();
  const editedBeta: HelpArticle = { id: 'beta', en: { ...BETA.en, setup: 'beta en setup, now with a new step' } };
  const catalog = createCatalog({ articles: [ALPHA, editedBeta, GAMMA], translations: old.translations });

  assert.deepEqual(staleTranslations(catalog), [
    { article: 'beta', language: 'ru', stale: 'stale', from: digestOf(BETA.en), current: digestOf(editedBeta.en) },
    { article: 'beta', language: 'uk', stale: 'stale', from: digestOf(BETA.en), current: digestOf(editedBeta.en) },
  ]);
  assert.notEqual(digestOf(editedBeta.en), digestOf(BETA.en));
});

test('a translated body with no from entry is listed as unknown, with from null — never passed as fresh', () => {
  const old = bootstrapped();
  const uk = old.translations.uk;
  assert.ok(uk !== undefined);
  const { alpha: _dropped, ...rest } = uk.from;
  const catalog = createCatalog({ articles: ARTICLES, translations: { ...old.translations, uk: { bodies: uk.bodies, from: rest } } });

  assert.deepEqual(staleTranslations(catalog), [{ article: 'alpha', language: 'uk', stale: 'unknown', from: null, current: digestOf(ALPHA.en) }]);
});

test('the list is in article order, then language order — the order a reviewer reads the help in', () => {
  const old = bootstrapped();
  const rewritten = ARTICLES.map((a) => ({ id: a.id, en: body(`${a.id} en, rewritten`) }));
  const catalog = createCatalog({ articles: rewritten, translations: old.translations });

  assert.deepEqual(
    staleTranslations(catalog).map((entry) => `${entry.article}/${entry.language}`),
    ['alpha/ru', 'alpha/uk', 'alpha/de', 'beta/ru', 'beta/uk', 'gamma/ru'],
  );
});

test('a body that is missing is not stale — it falls back to the current English and is coverage’s business', () => {
  const catalog = bootstrapped();

  assert.equal(bodyFor(catalog, GAMMA, 'uk').fallback, true);
  assert.equal(staleTranslations(catalog).some((entry) => entry.article === 'gamma' && entry.language === 'uk'), false);
});

// ---------- everyArticleInEveryLanguage ----------

test('coverage lists every article a language it offers does not translate, in order', () => {
  assert.deepEqual(everyArticleInEveryLanguage(bootstrapped()), {
    complete: false,
    missing: [
      { article: 'beta', language: 'de' },
      { article: 'gamma', language: 'uk' },
      { article: 'gamma', language: 'de' },
    ],
  });
});

test('coverage is complete when every offered language translates every article; a language with no module is not offered', () => {
  const all = ['alpha', 'beta', 'gamma'];
  const catalog = createCatalog({ articles: ARTICLES, translations: { ru: unstamped('ru', all), es: unstamped('es', all) } });

  assert.deepEqual(everyArticleInEveryLanguage(catalog), { complete: true, missing: [] });
  assert.deepEqual(everyArticleInEveryLanguage(createCatalog({ articles: ARTICLES, translations: {} })), { complete: true, missing: [] });
});

test('over coai’s own coverage (as recorded) every article is in every language — what coai’s own test asserted', () => {
  const { articleIds, translatedIds } = RECORDED_HELP.real;
  const translations = Object.fromEntries(TRANSLATED_LANGUAGES.map((language) => [language, unstamped(language, translatedIds[language])]));
  const catalog = createCatalog({ articles: articleIds.map(article), translations });

  assert.deepEqual(everyArticleInEveryLanguage(catalog), { complete: true, missing: [] });
  assert.equal(staleTranslations(catalog).length, articleIds.length * 4, 'before its bootstrap every coai translation is unknown');
  assert.deepEqual(staleTranslations(bootstrapped({ articles: catalog.articles, translations })), []);
});
