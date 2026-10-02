import { bodyFor, translatedEntry, translatedLanguages } from './catalog';
import { digestOf } from './digest';
import type { ArticleId, Catalog, Digest, HelpArticle, TranslatedLanguage } from './types';

/**
 * The checks a CONSUMER's own suite runs over its catalog — both are meant to be asserted empty there.
 *
 * <p><b>`staleTranslations`</b> (epic 2 plan round, finding 0): a stale translation is the signal the kit
 * exists to give, not a defect in itself — but an English edit committed without its translations must
 * fail the consumer's CI, not reach a reader. So it lists every translated body that is `stale` or
 * `unknown`, and `help-digests` prints the replacement `from` line for each.</p>
 *
 * <p><b>`everyArticleInEveryLanguage`</b>: coai's *every article exists in every language the switch
 * offers* (`helpCoverage.test.ts`). The fallback is honest for a reader and silent for a build: a new
 * article would quietly become English-only in four languages and nothing would say so.</p>
 *
 * <p>Both decide through `bodyFor`, so neither can disagree with what a reader is shown.</p>
 */

/** One translated body that was not made from the current English. */
export interface StaleTranslation {
  readonly article: ArticleId;
  readonly language: TranslatedLanguage;
  /** `stale`: its `from` is an older English digest. `unknown`: it records no `from` at all. */
  readonly stale: 'stale' | 'unknown';
  /** The digest it was made from, or `null` when it records none. */
  readonly from: Digest | null;
  /** The current English digest — the value its `from` entry becomes once it has been re-checked. */
  readonly current: Digest;
}

/** One article a language the catalog offers does not translate. */
export interface MissingTranslation {
  readonly article: ArticleId;
  readonly language: TranslatedLanguage;
}

export interface Coverage {
  /** Every offered language translates every article. */
  readonly complete: boolean;
  /** What is not translated, in article order, then language order. */
  readonly missing: readonly MissingTranslation[];
}

/** Every translated body that is `stale` or `unknown`, in article order, then language order. Empty is the goal. */
export function staleTranslations(catalog: Catalog): readonly StaleTranslation[] {
  return pairs(catalog).flatMap(({ article, language }) => staleEntry(catalog, article, language));
}

/** Whether every language the catalog offers translates every article, and which do not. */
export function everyArticleInEveryLanguage(catalog: Catalog): Coverage {
  const missing = pairs(catalog)
    .filter(({ article, language }) => bodyFor(catalog, article, language).fallback)
    .map(({ article, language }) => ({ article: article.id, language }));

  return { complete: missing.length === 0, missing };
}

/** Every article against every translated language the catalog offers. */
function pairs(catalog: Catalog): { article: HelpArticle; language: TranslatedLanguage }[] {
  const languages = translatedLanguages(catalog);

  return catalog.articles.flatMap((article) => languages.map((language) => ({ article, language })));
}

function staleEntry(catalog: Catalog, article: HelpArticle, language: TranslatedLanguage): StaleTranslation[] {
  const { stale } = bodyFor(catalog, article, language);
  if (stale === 'fresh') {
    return [];
  }

  return [{ article: article.id, language, stale, from: translatedEntry(catalog, article.id, language)?.from ?? null, current: digestOf(article.en) }];
}
