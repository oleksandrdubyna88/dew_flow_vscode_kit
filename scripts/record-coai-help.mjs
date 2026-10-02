#!/usr/bin/env node
/**
 * Records `src/test/fixtures/coai-help-1056aed9.json` from ConnectOtherAIs' OWN help engine.
 *
 * <p>The kit's `bodyFor` must answer exactly what coai's did for coai's content — the body and the
 * `fallback` flag — and add only `stale`. So the expected answers are COMPUTED by coai's real
 * `helpContent.ts` (`bodyFor`, `HELP_LANGUAGES`, `HELP_LANGUAGE_LABELS`), never retyped.</p>
 *
 * Usage, from this repository's root, with a ConnectOtherAIs checkout beside it:
 *   node scripts/record-coai-help.mjs <path-to-dew_flow_connect_other_ais> [ref=1056aed9] > src/test/fixtures/coai-help-1056aed9.json
 *
 * Two compilations of the same `helpContent.ts`:
 *
 * - **synthetic** — coai's four translation modules replaced by small partial ones written here, so the
 *   recording covers a missing body, an empty language, and an article id that is a prototype key
 *   (`constructor`), with bodies small enough to keep in a fixture. The articles and translations are
 *   INPUT and are recorded beside coai's answers, so the kit is fed the same data.
 * - **real** — coai's own `helpRu/Uk/De/Es.ts`: the article ids in their order, the ids each language
 *   translates (input), and coai's `fallback` for every article in every language (output). Bodies are
 *   not recorded; the real content is 800 KB and the coai switch PR snapshots its rendered help instead.
 */
import { compileCoaiModules } from './coai-modules.mjs';

const [coai, ref = '1056aed9'] = process.argv.slice(2);
if (!coai) {
  process.stderr.write('usage: node scripts/record-coai-help.mjs <coai checkout> [ref]\n');
  process.exit(64);
}

/** coai's translation modules: file name → the constant `helpContent.ts` imports from it. */
const MODULES = { ru: ['helpRu', 'RU'], uk: ['helpUk', 'UK'], de: ['helpDe', 'DE'], es: ['helpEs', 'ES'] };

const body = (tag) => ({
  title: `${tag} title`,
  whatItIs: `${tag} what it is`,
  why: `${tag} why`,
  setup: `${tag} setup`,
  usage: `${tag} usage`,
  whatCanGoWrong: `${tag} what can go wrong`,
});

const SYNTHETIC_IDS = ['alpha', 'beta', 'gamma', 'constructor'];
const SYNTHETIC_ARTICLES = SYNTHETIC_IDS.map((id) => ({ id, en: body(`${id} en`) }));
/** Partial on purpose: ru two of four, uk one, de none, es three. No language translates `constructor`. */
const SYNTHETIC_TRANSLATIONS = {
  ru: { alpha: body('alpha ru'), beta: body('beta ru') },
  uk: { alpha: body('alpha uk') },
  de: {},
  es: { alpha: body('alpha es'), beta: body('beta es'), gamma: body('gamma es') },
};

const translationModule = (constant, bodies) =>
  `import { HelpBody } from './helpContent';\nexport const ${constant}: Readonly<Record<string, HelpBody>> = ${JSON.stringify(bodies, null, 2)};\n`;

/** What coai's `bodyFor` answered, as data; a body that is not an object (an inherited member) is recorded by its type. */
function answer(content, article, language) {
  const { body: shown, fallback } = content.bodyFor(article, language);
  const bodyType = typeof shown;

  return { article: article.id, language, fallback, bodyType, body: bodyType === 'object' ? shown : null };
}

function recordSynthetic() {
  const extra = Object.fromEntries(
    Object.entries(MODULES).map(([language, [file, constant]]) => [`${file}.ts`, translationModule(constant, SYNTHETIC_TRANSLATIONS[language])]),
  );
  const modules = compileCoaiModules({ coai, ref, sources: ['helpContent'], extra });
  try {
    const content = modules.load('helpContent');
    return {
      languages: [...content.HELP_LANGUAGES],
      labels: { ...content.HELP_LANGUAGE_LABELS },
      synthetic: {
        articles: SYNTHETIC_ARTICLES,
        translations: SYNTHETIC_TRANSLATIONS,
        bodyFor: SYNTHETIC_ARTICLES.flatMap((article) => content.HELP_LANGUAGES.map((language) => answer(content, article, language))),
      },
    };
  } finally {
    modules.dispose();
  }
}

function recordReal() {
  const files = Object.values(MODULES).map(([file]) => file);
  const modules = compileCoaiModules({ coai, ref, sources: ['helpContent', ...files] });
  try {
    const content = modules.load('helpContent');
    const translatedIds = Object.fromEntries(
      Object.entries(MODULES).map(([language, [file, constant]]) => [language, Object.keys(modules.load(file)[constant])]),
    );
    return {
      articleIds: content.HELP_ARTICLES.map((article) => article.id),
      translatedIds,
      fallback: content.HELP_ARTICLES.flatMap((article) =>
        content.HELP_LANGUAGES.map((language) => ({ article: article.id, language, fallback: content.bodyFor(article, language).fallback })),
      ),
    };
  } finally {
    modules.dispose();
  }
}

const out = {
  source: `dew_flow_connect_other_ais@${ref} src_vs_code/src/helpContent.ts (bodyFor, HELP_LANGUAGES, HELP_LANGUAGE_LABELS), helpRu/Uk/De/Es.ts`,
  ...recordSynthetic(),
  real: recordReal(),
};
process.stdout.write(JSON.stringify(out, null, 2) + '\n');
