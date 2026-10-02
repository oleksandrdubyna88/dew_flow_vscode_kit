import { createCatalog, type CatalogInput } from '../../help/catalog';
import { digestOf } from '../../help/digest';
import type { HelpArticle, HelpBody } from '../../help/types';

/**
 * A consumer's catalog module, as `scripts/help-digests.mjs` loads one — compiled with the suite, loaded
 * by `helpDigests.test.ts` through the script itself. Every `from` is read back from `digestOf`.
 *
 * - `catalog`: ru translates all three articles — alpha fresh, beta made from an OLDER English, gamma with
 *   no `from`; uk translates alpha with no `from`; de translates nothing.
 * - `freshCatalog`: the same articles, every translation made from the current English.
 * - `brokenInput`: not a catalog — a translated body for an article that does not exist.
 */

const body = (tag: string): HelpBody => ({
  title: `${tag} title`,
  whatItIs: `${tag} what it is`,
  why: `${tag} why`,
  setup: `${tag} setup`,
  usage: `${tag} usage`,
  whatCanGoWrong: `${tag} what can go wrong`,
});

export const ALPHA: HelpArticle = { id: 'alpha', en: body('alpha en') };
export const BETA: HelpArticle = { id: 'beta', en: body('beta en') };
export const GAMMA: HelpArticle = { id: 'gamma', en: body('gamma en') };
/** The English beta the ru translation was made from, before the edit. */
export const BETA_BEFORE: HelpBody = body('beta en, before the edit');

export const catalog = createCatalog({
  articles: [ALPHA, BETA, GAMMA],
  translations: {
    ru: {
      bodies: { alpha: body('alpha ru'), beta: body('beta ru'), gamma: body('gamma ru') },
      from: { alpha: digestOf(ALPHA.en), beta: digestOf(BETA_BEFORE) },
    },
    uk: { bodies: { alpha: body('alpha uk') }, from: {} },
    de: { bodies: {}, from: {} },
  },
});

export const freshCatalog = createCatalog({
  articles: [ALPHA, BETA, GAMMA],
  translations: {
    ru: { bodies: { alpha: body('alpha ru') }, from: { alpha: digestOf(ALPHA.en) } },
  },
});

export const brokenInput: CatalogInput = {
  articles: [ALPHA],
  translations: { ru: { bodies: { omega: body('omega ru') }, from: {} } },
};
