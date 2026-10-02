import { translatedLanguages } from './catalog';
import { digestOf } from './digest';
import type { Catalog, Digest, HelpArticle, TranslatedLanguage, Translation, Translations } from './types';

/**
 * The one-time bootstrap of a catalog whose translation modules record no `from` yet (plan §2; epic 2
 * plan round, finding 0).
 *
 * <p>Returns NEW translation objects, one per module the catalog has, each with `from` stamped to the
 * CURRENT English digest of every body it carries, in article order; `bodies` is the module's own map,
 * handed through unchanged. Nothing it is given is written.</p>
 *
 * <p><b>The assumption it makes is stated, not hidden:</b> that the translations shipped today match
 * today's English. That is true at the ConnectOtherAIs switch, which is the one place it is meant to run —
 * a consumer pastes the stamped `from` maps into its modules once and commits them. Run on every build it
 * would declare every translation fresh forever and turn stale detection off; after a deliberate
 * re-translation the right tool is `help-digests`, which prints the replacement `from` line for exactly
 * the entries that need one.</p>
 */
export function stampTranslations(catalog: Catalog): Translations {
  const stamped: [TranslatedLanguage, Translation][] = translatedLanguages(catalog).flatMap((language) => {
    const translation = catalog.translations[language];
    return translation === undefined ? [] : [[language, { bodies: translation.bodies, from: stampedFrom(catalog.articles, translation) }]];
  });

  return Object.fromEntries(stamped);
}

function stampedFrom(articles: readonly HelpArticle[], translation: Translation): Readonly<Record<string, Digest>> {
  return Object.fromEntries(
    articles.filter((article) => Object.hasOwn(translation.bodies, article.id)).map((article) => [article.id, digestOf(article.en)]),
  );
}
