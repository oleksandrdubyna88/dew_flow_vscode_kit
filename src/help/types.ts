/**
 * The shapes of the help catalog: an article, its body, a translation, the catalog that holds them.
 *
 * <p>Extracted from ConnectOtherAIs (`src_vs_code/src/helpContent.ts` at `1056aed9`) — the types, the
 * five languages and their labels are coai's, unchanged. What coai kept in module-level constants (its
 * articles, its four translation modules) a consumer now passes in, through `createCatalog`.</p>
 *
 * <p><b>The type enforces the style</b>, as it did in coai: every article answers the same five
 * questions — what it is, why, how to set it up, how to use it, what can go wrong — and a body that skips
 * one does not compile. English is required on every article; the other languages are optional per
 * article and fall back VISIBLY.</p>
 */

/** The languages a help page can be read in. English first: it is the floor every article has. */
export const HELP_LANGUAGES = ['en', 'ru', 'uk', 'de', 'es'] as const;
export type HelpLanguage = (typeof HELP_LANGUAGES)[number];

/** A language a translation module provides — every one but English, which the article itself carries. */
export type TranslatedLanguage = Exclude<HelpLanguage, 'en'>;

/** The translated languages, in the order the language switch lists them. */
export const TRANSLATED_LANGUAGES: readonly TranslatedLanguage[] = ['ru', 'uk', 'de', 'es'];

/** Each language by its own name, for the language switch. */
export const HELP_LANGUAGE_LABELS: Readonly<Record<HelpLanguage, string>> = {
  en: 'English',
  ru: 'Русский',
  uk: 'Українська',
  de: 'Deutsch',
  es: 'Español',
};

/** One article's text in one language. Every field required — the style IS the schema. */
export interface HelpBody {
  readonly title: string;
  readonly whatItIs: string;
  readonly why: string;
  readonly setup: string;
  readonly usage: string;
  readonly whatCanGoWrong: string;
}

/**
 * The six fields of a body, in the fixed order the digest reads them (plan §2, gate round 1). Changing
 * this order changes every digest, which marks every translation stale — it is part of the format.
 */
export const HELP_BODY_FIELDS: readonly (keyof HelpBody)[] = ['title', 'whatItIs', 'why', 'setup', 'usage', 'whatCanGoWrong'];

/** An article's id — the key a translation module files its body under. */
export type ArticleId = string;

export interface HelpArticle {
  readonly id: ArticleId;
  /** English is the floor; every other language lives in its own translation module. */
  readonly en: HelpBody;
}

/**
 * The digest of an English body: the first 8 lowercase hex characters of SHA-256 over its canonical form
 * (`digest.ts`). A plain string, so a translation module's `from` map is written as ordinary literals.
 */
export type Digest = string;

/**
 * One translation module: what it translated, and from which English text.
 *
 * <p>`bodies` maps an article id to its translated body; a missing key falls back to English. `from` maps
 * the same id to the digest of the ENGLISH body the translation was made from — so a later edit of the
 * English marks the translation stale instead of leaving it silently a release behind, which coai's own
 * tests named as the trap nothing could see (`helpCoverage.test.ts`). A body with no `from` entry is
 * reported as `unknown`, never assumed fresh.</p>
 */
export interface Translation {
  readonly bodies: Readonly<Record<ArticleId, HelpBody>>;
  readonly from: Readonly<Record<ArticleId, Digest>>;
}

/** The translations of a catalog, one module per language; a language with no module is not offered. */
export type Translations = Readonly<Partial<Record<TranslatedLanguage, Translation>>>;

/** A validated catalog — made by `createCatalog`, never by hand. */
export interface Catalog {
  /** English, then every language that has a translation module, in `HELP_LANGUAGES` order. */
  readonly languages: readonly HelpLanguage[];
  /** The articles, in the order the index lists them. */
  readonly articles: readonly HelpArticle[];
  readonly translations: Translations;
}

/**
 * Whether the body SHOWN was made from the current English text: `fresh` when it was (and for English
 * itself, and for an English fallback), `stale` when its `from` digest differs from the current English
 * digest, `unknown` when the translation records no `from` at all.
 */
export type Staleness = 'fresh' | 'stale' | 'unknown';

/** An article as shown in one language. */
export interface ShownBody {
  readonly body: HelpBody;
  /** The language had no body for this article, so English is shown with a visible note. */
  readonly fallback: boolean;
  readonly stale: Staleness;
}
