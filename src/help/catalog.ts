import { digestOf, fieldNotText, isDigest } from './digest';
import {
  HELP_BODY_FIELDS,
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
} from './types';

/**
 * The help catalog: made once from what a consumer passes in, then asked for an article in a language.
 *
 * <p>The engine of ConnectOtherAIs' `helpContent.ts` at `1056aed9` — `bodyFor` answers the same body and
 * the same `fallback` coai did for coai's content (`src/test/helpCatalog.test.ts` holds it against
 * answers recorded from coai's own module) — with two changes:</p>
 *
 * <ul>
 *   <li><b>`stale`</b>, the plan's addition: a translated body whose `from` digest is not the current
 *   English digest is `stale`; one with no `from` entry is `unknown`, never assumed fresh.</li>
 *   <li><b>Own properties only.</b> coai looked a body up as `TRANSLATIONS[language][article.id]`, so an
 *   article whose id is a key of `Object.prototype` (`constructor`) got the Object FUNCTION back as its
 *   translated body. Here such an id is looked up like any other — recorded as a deviation.</li>
 * </ul>
 *
 * <p>`createCatalog` is the boundary: what it is handed is checked once, and every refusal names what is
 * wrong, where, and what would be accepted — a typo in a translation module is a consumer's programming
 * error, found when the extension loads rather than when a reader opens the article. What is checked is a
 * COPY, and the copy is what the catalog keeps, frozen all the way down — every article, body,
 * translation and `from` map — so the check made once stays true of every answer after it.</p>
 */

/** What a consumer hands `createCatalog`: its articles in index order, and one module per translated language. */
export interface CatalogInput {
  readonly articles: readonly HelpArticle[];
  readonly translations: Translations;
}

/** A body in a translation module, with the digest of the English it was made from — if it records one. */
export interface TranslatedEntry {
  readonly body: HelpBody;
  readonly from: Digest | undefined;
}

/**
 * Validate the input and make the catalog. Throws a `TypeError` naming the first defect. Never writes its
 * input and never holds it: the catalog is made of frozen copies, so an edit to the input afterwards
 * changes nothing the catalog answers.
 */
export function createCatalog(input: CatalogInput): Catalog {
  const articles = checkedArticles(input.articles);
  const translations = checkedTranslations(input.translations, new Set(articles.map((article) => article.id)));
  const languages: readonly HelpLanguage[] = Object.freeze(['en', ...TRANSLATED_LANGUAGES.filter((language) => Object.hasOwn(translations, language))]);

  return Object.freeze({ languages, articles, translations });
}

/** The article as shown in `language`: its translation, or English with `fallback` — and whether it is current. */
export function bodyFor(catalog: Catalog, article: HelpArticle, language: HelpLanguage): ShownBody {
  const entry = language === 'en' ? undefined : translatedEntry(catalog, article.id, language);
  if (entry === undefined) {
    return { body: article.en, fallback: language !== 'en', stale: 'fresh' };
  }

  return { body: entry.body, fallback: false, stale: stalenessOf(entry.from, article.en) };
}

/** The language's own body for an article and its `from`, or nothing — own properties only. */
export function translatedEntry(catalog: Catalog, id: ArticleId, language: TranslatedLanguage): TranslatedEntry | undefined {
  const translation = ownValue(catalog.translations, language);

  return translation === undefined ? undefined : entryIn(translation, id);
}

function entryIn(translation: Translation, id: ArticleId): TranslatedEntry | undefined {
  const body = ownValue(translation.bodies, id);

  return body === undefined ? undefined : { body, from: ownValue(translation.from, id) };
}

/** The translated languages a catalog offers, in the switch's order. */
export function translatedLanguages(catalog: Catalog): readonly TranslatedLanguage[] {
  return catalog.languages.filter(isTranslated);
}

function isTranslated(language: HelpLanguage): language is TranslatedLanguage {
  return language !== 'en';
}

function stalenessOf(from: Digest | undefined, english: HelpBody): Staleness {
  if (from === undefined) {
    return 'unknown';
  }

  return from === digestOf(english) ? 'fresh' : 'stale';
}

function ownValue<K extends string, V>(record: Readonly<Partial<Record<K, V>>>, key: K): V | undefined {
  return Object.hasOwn(record, key) ? record[key] : undefined;
}

// ---------- the boundary ----------
//
// Every record is COPIED before it is checked, and the copy is what is checked, frozen and kept (gate,
// epic 2 code round, finding 5): a catalog that held the consumer's own objects would show an edit made
// to them after validation — a title, a body field, a `from` digest, an id — and the check made once at
// load would no longer describe what a reader sees. A body copy carries the six fields and nothing else,
// read once each; an article copy its id and its English. Nothing the catalog holds is reachable from
// the input, and nothing reachable from the catalog can be written.

function checkedArticles(articles: readonly HelpArticle[]): readonly HelpArticle[] {
  if (!Array.isArray(articles) || articles.length === 0) {
    throw new TypeError('A help catalog needs at least one article.');
  }
  const copies = Array.from(articles, checkedArticle);
  const ids = copies.map((article) => article.id);
  const repeated = ids.find((id, index) => ids.indexOf(id) !== index);
  if (repeated !== undefined) {
    throw new TypeError(`Help article ${repeated} appears more than once; a lookup by id would only ever find the first.`);
  }

  return Object.freeze(copies);
}

function checkedArticle(value: unknown): HelpArticle {
  const article = copiedArticle(value);
  checkArticle(article);

  return article;
}

/** A frozen copy of an article's id and English body — or the value itself when it is no object, for the check to refuse. */
function copiedArticle(value: unknown): unknown {
  return isRecord(value) ? Object.freeze({ id: member(value, 'id'), en: copiedBody(member(value, 'en')) }) : value;
}

/** A frozen copy of a body's six fields, each read once — or the value itself when it is no object, for the check to refuse. */
function copiedBody(value: unknown): unknown {
  return isRecord(value) ? Object.freeze(Object.fromEntries(HELP_BODY_FIELDS.map((field) => [field, Reflect.get(value, field)]))) : value;
}

function checkArticle(article: unknown): asserts article is HelpArticle {
  const id = member(article, 'id');
  if (typeof id !== 'string' || id === '') {
    throw new TypeError(`Every help article needs an id that is a non-empty string; got ${describe(id)}.`);
  }
  checkBody(member(article, 'en'), `The English body of ${id}`);
}

function checkedTranslations(translations: Translations, ids: ReadonlySet<ArticleId>): Translations {
  if (!isRecord(translations)) {
    throw new TypeError(`A help catalog's translations are an object of translation modules by language; got ${describe(translations)}.`);
  }
  const languages = Object.keys(translations);
  const unknown = languages.find((language) => !isTranslatedLanguage(language));
  if (unknown !== undefined) {
    throw new TypeError(`Help has no translation module for ${unknown}: a module is one of ${TRANSLATED_LANGUAGES.join(', ')} — English is the articles themselves.`);
  }
  // Checked in the switch's order, so the defect named first does not depend on how the modules were
  // written down; kept in the consumer's own order, as the catalog always kept them.
  const checked = TRANSLATED_LANGUAGES.filter((language) => languages.includes(language))
    .map((language): [TranslatedLanguage, Translation] => [language, checkedTranslation(language, member(translations, language), ids)]);

  return Object.freeze(Object.fromEntries([...checked].sort(([a], [b]) => languages.indexOf(a) - languages.indexOf(b))));
}

function isTranslatedLanguage(language: string): language is TranslatedLanguage {
  return TRANSLATED_LANGUAGES.some((known) => known === language);
}

/** One translation module, checked and copied: its bodies, then its `from` digests against the copied bodies. */
function checkedTranslation(language: TranslatedLanguage, translation: unknown, ids: ReadonlySet<ArticleId>): Translation {
  const { bodies, from } = mapsOf(language, translation);
  const copiedBodies: Readonly<Record<ArticleId, HelpBody>> = Object.freeze(Object.fromEntries(
    Object.entries(bodies).map(([id, body]) => [id, checkedTranslatedBody(language, id, body, ids)]),
  ));
  const copiedFrom: Readonly<Record<ArticleId, Digest>> = Object.freeze(Object.fromEntries(
    Object.entries(from).map(([id, digest]) => [id, checkedFrom(language, id, digest, copiedBodies)]),
  ));

  return Object.freeze({ bodies: copiedBodies, from: copiedFrom });
}

/** A translation's two maps, refused unless both are plain objects. */
function mapsOf(language: TranslatedLanguage, translation: unknown): { bodies: Readonly<Record<string, unknown>>; from: Readonly<Record<string, unknown>> } {
  const bodies = member(translation, 'bodies');
  const from = member(translation, 'from');
  if (!isRecord(bodies) || !isRecord(from)) {
    throw new TypeError(`The ${language} translation needs a bodies map and a from map, both objects keyed by article id.`);
  }

  return { bodies, from };
}

/** `ids` is a set made once per catalog — a lookup per translated body, not a scan of every article id. */
function checkedTranslatedBody(language: TranslatedLanguage, id: string, body: unknown, ids: ReadonlySet<ArticleId>): HelpBody {
  if (!ids.has(id)) {
    throw new TypeError(`The ${language} translation has a body for ${id}, which is not an article of this catalog: ${[...ids].join(', ')}.`);
  }
  const copy = copiedBody(body);
  checkBody(copy, `The ${language} body of ${id}`);

  return copy;
}

function checkedFrom(language: TranslatedLanguage, id: string, digest: unknown, bodies: Readonly<Record<string, unknown>>): Digest {
  if (!Object.hasOwn(bodies, id)) {
    throw new TypeError(`The ${language} translation has a from entry for ${id} but no body for it; remove the entry or add the body.`);
  }
  if (!isDigest(digest)) {
    throw new TypeError(`The ${language} from entry for ${id} is ${describe(digest)}, not a digest: 8 lowercase hex characters, as help-digests prints them.`);
  }

  return digest;
}

function checkBody(body: unknown, where: string): asserts body is HelpBody {
  if (!isRecord(body)) {
    throw new TypeError(`${where} is ${describe(body)}, not a help body.`);
  }
  const missing = fieldNotText(body);
  if (missing !== undefined) {
    throw new TypeError(`${where} has no text in ${missing}: every one of ${HELP_BODY_FIELDS.join(', ')} is required.`);
  }
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** An own member of a value that may not be an object at all. */
function member(value: unknown, key: string): unknown {
  return isRecord(value) && Object.hasOwn(value, key) ? value[key] : undefined;
}

function describe(value: unknown): string {
  return typeof value === 'string' ? JSON.stringify(value) : String(value);
}
