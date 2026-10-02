import assert from 'node:assert/strict';
import { test } from 'node:test';

import { bodyFor, createCatalog, type CatalogInput } from '../help/catalog';
import { digestOf } from '../help/digest';
import {
  HELP_LANGUAGE_LABELS,
  HELP_LANGUAGES,
  TRANSLATED_LANGUAGES,
  type HelpArticle,
  type HelpBody,
  type Translation,
} from '../help/types';
import { RECORDED_HELP } from './coaiFixture';

/**
 * The help catalog: `createCatalog` validates what a consumer passes in; `bodyFor` answers an article in
 * a language as `{ body, fallback, stale }`.
 *
 * - **`body` and `fallback` are coai's**, held against answers RECORDED from coai's own `helpContent.ts`
 *   at `1056aed9` (`scripts/record-coai-help.mjs`), over coai's own id coverage and over partial
 *   translations coai's real content never exercises.
 * - **`stale` is new** (plan §2): `fresh` / `stale` / `unknown`, decided by the translation's `from`
 *   digest against the CURRENT English digest — read back from `digestOf`, never guessed.
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

/** A translation of `ids`, made from the given articles' CURRENT English — every `from` read back from `digestOf`. */
function translationOf(language: string, made: readonly HelpArticle[]): Translation {
  return {
    bodies: Object.fromEntries(made.map((a) => [a.id, body(`${a.id} ${language}`)])),
    from: Object.fromEntries(made.map((a) => [a.id, digestOf(a.en)])),
  };
}

const ALPHA = article('alpha');
const BETA = article('beta');
const GAMMA = article('gamma');
const ARTICLES: readonly HelpArticle[] = [ALPHA, BETA, GAMMA];

/** ru translates all three, uk two, de one; es has no module. Every `from` current. */
function fresh(): CatalogInput {
  return {
    articles: ARTICLES,
    translations: {
      ru: translationOf('ru', ARTICLES),
      uk: translationOf('uk', [ALPHA, BETA]),
      de: translationOf('de', [ALPHA]),
    },
  };
}

// ---------- body and fallback: what coai answered ----------

test('the languages and their labels are coai’s', () => {
  assert.deepEqual([...HELP_LANGUAGES], RECORDED_HELP.languages);
  assert.deepEqual(HELP_LANGUAGE_LABELS, RECORDED_HELP.labels);
  assert.match(RECORDED_HELP.source, /1056aed9/);
});

/** The recorded synthetic input as a kit catalog: coai had no `from`, so every translation has none. */
function recordedSynthetic() {
  const translations = Object.fromEntries(
    TRANSLATED_LANGUAGES.map((language) => [language, { bodies: RECORDED_HELP.synthetic.translations[language], from: {} }]),
  );

  return createCatalog({ articles: RECORDED_HELP.synthetic.articles, translations });
}

const byId = (id: string): HelpArticle => {
  const found = RECORDED_HELP.synthetic.articles.find((a) => a.id === id);
  assert.ok(found !== undefined, `the recording has no article ${id}`);
  return found;
};

test('the recording covers what the tests below claim: a fallback, a translation, and an inherited member', () => {
  const answers = RECORDED_HELP.synthetic.bodyFor;
  assert.ok(answers.some((a) => a.fallback && a.bodyType === 'object'), 'no fallback in the recording');
  assert.ok(answers.some((a) => !a.fallback && a.language !== 'en' && a.bodyType === 'object'), 'no translation in the recording');
  assert.ok(answers.some((a) => a.bodyType === 'function'), 'no inherited member in the recording');
});

for (const recorded of RECORDED_HELP.synthetic.bodyFor.filter((a) => a.bodyType === 'object')) {
  test(`${recorded.article}/${recorded.language}: body and fallback are what coai's bodyFor answered`, () => {
    const shown = bodyFor(recordedSynthetic(), byId(recorded.article), recorded.language);

    assert.deepEqual(shown.body, recorded.body);
    assert.equal(shown.fallback, recorded.fallback);
  });
}

test('where coai answered an INHERITED member as a body, the kit answers the English fallback (deviation)', () => {
  // coai looked a body up as `TRANSLATIONS[language][article.id]`, so an article whose id is a key of
  // Object.prototype — `constructor` — got the Object FUNCTION as its translated body, with
  // `fallback: false`. The recording keeps that as evidence; the kit reads own properties only.
  const inherited = RECORDED_HELP.synthetic.bodyFor.filter((a) => a.bodyType === 'function');
  assert.deepEqual(inherited.map((a) => `${a.article}/${a.language}`), ['constructor/ru', 'constructor/uk', 'constructor/de', 'constructor/es']);

  for (const recorded of inherited) {
    const shown = bodyFor(recordedSynthetic(), byId(recorded.article), recorded.language);
    assert.deepEqual(shown, { body: byId(recorded.article).en, fallback: true, stale: 'fresh' });
  }
});

test('over coai’s own coverage (33 articles, four modules) the kit falls back exactly where coai did', () => {
  const { articleIds, translatedIds, fallback } = RECORDED_HELP.real;
  const articles = articleIds.map(article);
  const translations = Object.fromEntries(
    TRANSLATED_LANGUAGES.map((language) => [language, translationOf(language, articles.filter((a) => translatedIds[language].includes(a.id)))]),
  );
  const catalog = createCatalog({ articles, translations });

  assert.deepEqual(catalog.articles.map((a) => a.id), articleIds);
  assert.deepEqual(
    catalog.articles.flatMap((a) => HELP_LANGUAGES.map((language) => ({ article: a.id, language, fallback: bodyFor(catalog, a, language).fallback }))),
    fallback,
  );
});

test('a recorded translation carries no from, so the kit reports it unknown — never assumed fresh', () => {
  const shown = bodyFor(recordedSynthetic(), byId('alpha'), 'ru');

  assert.equal(shown.fallback, false);
  assert.equal(shown.stale, 'unknown');
});

// ---------- stale: what the kit adds ----------

test('a translation made from the current English is fresh, in every language that has it', () => {
  const catalog = createCatalog(fresh());

  for (const a of ARTICLES) {
    for (const language of catalog.languages) {
      assert.equal(bodyFor(catalog, a, language).stale, 'fresh', `${a.id}/${language}`);
    }
  }
});

test('an English edit makes exactly that article stale, in every language that has it; the rest stay fresh', () => {
  const editedBeta: HelpArticle = { id: 'beta', en: { ...BETA.en, usage: 'beta en usage, rewritten' } };
  const catalog = createCatalog({ ...fresh(), articles: [ALPHA, editedBeta, GAMMA] });

  const answers = catalog.articles.flatMap((a) =>
    catalog.languages.map((language) => `${a.id}/${language}: ${bodyFor(catalog, a, language).stale}`),
  );
  assert.deepEqual(answers, [
    'alpha/en: fresh', 'alpha/ru: fresh', 'alpha/uk: fresh', 'alpha/de: fresh',
    'beta/en: fresh', 'beta/ru: stale', 'beta/uk: stale', 'beta/de: fresh',
    'gamma/en: fresh', 'gamma/ru: fresh', 'gamma/uk: fresh', 'gamma/de: fresh',
  ]);
  // beta/de is not stale because there is no German beta: German readers get the (current) English.
  assert.equal(bodyFor(catalog, editedBeta, 'de').fallback, true);
});

test('a translated body with no from entry is unknown, not fresh', () => {
  const input = fresh();
  const ru = input.translations.ru;
  assert.ok(ru !== undefined);
  const { beta: _dropped, ...rest } = ru.from;
  const withoutBetaFrom: Translation = { bodies: ru.bodies, from: rest };
  const catalog = createCatalog({ ...input, translations: { ...input.translations, ru: withoutBetaFrom } });

  assert.deepEqual(bodyFor(catalog, BETA, 'ru'), { body: body('beta ru'), fallback: false, stale: 'unknown' });
  assert.equal(bodyFor(catalog, ALPHA, 'ru').stale, 'fresh');
});

test('English itself and an English fallback are always fresh: what is shown IS the current English', () => {
  const editedGamma: HelpArticle = { id: 'gamma', en: body('gamma en, rewritten') };
  const catalog = createCatalog({ ...fresh(), articles: [ALPHA, BETA, editedGamma] });

  assert.deepEqual(bodyFor(catalog, editedGamma, 'en'), { body: editedGamma.en, fallback: false, stale: 'fresh' });
  assert.deepEqual(bodyFor(catalog, editedGamma, 'uk'), { body: editedGamma.en, fallback: true, stale: 'fresh' });
  assert.deepEqual(bodyFor(catalog, editedGamma, 'es'), { body: editedGamma.en, fallback: true, stale: 'fresh' });
});

test('an article whose id is a prototype key is looked up as an own property, translated or not', () => {
  const ctor = article('constructor');
  const catalog = createCatalog({ articles: [ctor], translations: { ru: translationOf('ru', [ctor]), uk: { bodies: {}, from: {} } } });

  assert.deepEqual(bodyFor(catalog, ctor, 'ru'), { body: body('constructor ru'), fallback: false, stale: 'fresh' });
  assert.deepEqual(bodyFor(catalog, ctor, 'uk'), { body: ctor.en, fallback: true, stale: 'fresh' });
});

// ---------- createCatalog: the boundary ----------

test('the catalog offers English and every language with a module, in the switch’s order', () => {
  const reversed = { de: translationOf('de', [ALPHA]), ru: translationOf('ru', ARTICLES) };

  assert.deepEqual(createCatalog(fresh()).languages, ['en', 'ru', 'uk', 'de']);
  assert.deepEqual(createCatalog({ articles: ARTICLES, translations: reversed }).languages, ['en', 'ru', 'de']);
  assert.deepEqual(createCatalog({ articles: ARTICLES, translations: {} }).languages, ['en']);
});

const refusals: readonly { what: string; input: () => unknown; says: RegExp }[] = [
  { what: 'no articles', input: () => ({ articles: [], translations: {} }), says: /at least one article/ },
  { what: 'a duplicate article id', input: () => ({ articles: [ALPHA, BETA, article('alpha')], translations: {} }), says: /alpha.*more than once/ },
  { what: 'an empty article id', input: () => ({ articles: [article('')], translations: {} }), says: /id/ },
  {
    what: 'an English body missing a field',
    input: () => ({ articles: [{ id: 'alpha', en: { ...ALPHA.en, why: undefined } }], translations: {} }),
    says: /alpha.*why/,
  },
  { what: 'a language the help does not have', input: () => ({ articles: ARTICLES, translations: { fr: translationOf('fr', [ALPHA]) } }), says: /fr.*ru, uk, de, es/ },
  { what: 'a module for English', input: () => ({ articles: ARTICLES, translations: { en: translationOf('en', [ALPHA]) } }), says: /en.*ru, uk, de, es/ },
  {
    what: 'a translated body for an article the catalog does not have',
    input: () => ({ articles: [ALPHA], translations: { ru: translationOf('ru', [ALPHA, BETA]) } }),
    says: /ru.*beta.*alpha/,
  },
  {
    what: 'a from entry with no translated body beside it',
    input: () => ({ articles: ARTICLES, translations: { ru: { bodies: {}, from: { alpha: digestOf(ALPHA.en) } } } }),
    says: /ru.*alpha.*no body/,
  },
  {
    what: 'a from entry that is not a digest',
    input: () => ({ articles: ARTICLES, translations: { ru: { bodies: { alpha: body('alpha ru') }, from: { alpha: 'FB76C375' } } } }),
    says: /ru.*alpha.*FB76C375/,
  },
  {
    what: 'a translated body missing a field',
    input: () => ({ articles: ARTICLES, translations: { uk: { bodies: { alpha: { ...body('alpha uk'), usage: 42 } }, from: {} } } }),
    says: /uk.*alpha.*usage/,
  },
  { what: 'a translation with no bodies map', input: () => ({ articles: ARTICLES, translations: { ru: { from: {} } } }), says: /ru.*bodies/ },
];

for (const refusal of refusals) {
  test(`createCatalog refuses ${refusal.what}, saying what and where`, () => {
    // The input is deliberately outside the type — a consumer in plain JavaScript, or a typo the type let
    // through as `Record<string, …>` — so it is cast here, at the one call, and nowhere else.
    assert.throws(() => createCatalog(refusal.input() as CatalogInput), refusal.says);
  });
}

test('the fixture every refusal starts from is itself accepted — the refusals are about their one defect', () => {
  assert.doesNotThrow(() => createCatalog(fresh()));
});

test('createCatalog never writes its input, and the catalog does not follow later changes to it', () => {
  const input = fresh();
  const articles = [...input.articles];
  const deepFrozen = Object.freeze({
    articles: Object.freeze(articles.map((a) => Object.freeze({ ...a, en: Object.freeze({ ...a.en }) }))),
    translations: Object.freeze({ ...input.translations }),
  });
  const before = structuredClone(deepFrozen);

  const catalog = createCatalog(deepFrozen);
  assert.deepEqual(deepFrozen, before);

  const growing = [...ARTICLES];
  const fromGrowing = createCatalog({ articles: growing, translations: {} });
  growing.push(article('delta'));
  assert.deepEqual(fromGrowing.articles.map((a) => a.id), ['alpha', 'beta', 'gamma']);
  assert.notEqual(catalog.articles, deepFrozen.articles);
});

test('bodyFor reads the catalog and never writes it', () => {
  const catalog = createCatalog(fresh());
  const before = structuredClone(catalog);

  for (const a of ARTICLES) {
    for (const language of HELP_LANGUAGES) {
      bodyFor(catalog, a, language);
    }
  }
  assert.deepEqual(catalog, before);
});

