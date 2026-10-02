#!/usr/bin/env node
/**
 * Records `src/test/fixtures/coai-help-page-1056aed9.json` from ConnectOtherAIs' OWN help page.
 *
 * <p>The kit's `renderHelpPage` must return, for coai's configuration, the BYTES coai's `renderHelpHtml`
 * returned at `1056aed9` — given the same nonce and the same appendix. So the expected pages are rendered
 * by coai's real `helpPage.ts`, compiled here with coai's real engine (`helpContent.ts`), escapers and
 * display controls, never retyped (the family's testing rule).</p>
 *
 * Usage, from this repository's root, with a ConnectOtherAIs checkout beside it:
 *   node scripts/record-coai-help-page.mjs <path-to-dew_flow_connect_other_ais> [ref=1056aed9] > src/test/fixtures/coai-help-page-1056aed9.json
 *
 * <p><b>What is synthetic, and how it reaches coai's code.</b> coai's catalog is 800 KB of real content
 * that this fixture must not carry, so the ARTICLES are small ones written here; they are recorded as
 * INPUT beside coai's output, so the kit is fed exactly the same data. coai's `helpContent.ts` exports
 * `HELP_ARTICLES` as a plain `exports.HELP_ARTICLES = …` assignment, and `helpPage.ts` reads it through
 * the module object on every call — so after loading the engine the export is REASSIGNED to the
 * synthetic articles (the descriptor is checked to be writable, and the rendered page is checked to
 * name a synthetic id and no real one). The four translation modules and `helpPrompts.ts` are replaced
 * by small files written beside the sources, as `record-coai-help.mjs` does for the translations.</p>
 *
 * <p><b>The nonce</b> is minted inside coai's `renderHelpHtml` from `node:crypto`; it is read back from
 * the page it rendered (the CSP's `'nonce-…'` and the one `<script nonce="…">` must agree) and recorded
 * with that page, so the kit renders with the same one.</p>
 *
 * <p><b>The appendix</b> — coai's `promptsHtml()`, inserted into the `prompts-in-full` article — is a
 * private function, so it is recovered from coai's own output: a TWIN article with the same body under
 * another id renders identically except for its `data-article` attribute and the appendix, and the
 * difference between the two renders is the appendix, verified by reassembling both from it.</p>
 */
import { compileCoaiModules } from './coai-modules.mjs';

const [coai, ref = '1056aed9'] = process.argv.slice(2);
if (!coai) {
  process.stderr.write('usage: node scripts/record-coai-help-page.mjs <coai checkout> [ref]\n');
  process.exit(64);
}

/** coai's translation modules: file name → the constant `helpContent.ts` imports from it. */
const MODULES = { ru: ['helpRu', 'RU'], uk: ['helpUk', 'UK'], de: ['helpDe', 'DE'], es: ['helpEs', 'ES'] };
const SOURCES = ['asText', 'webviewHtml', 'zoomControl', 'textTone', 'helpContent', 'helpPage'];

const PROMPTS_ARTICLE = 'prompts-in-full';
const TWIN_ARTICLE = 'prompts-in-full-twin';

/**
 * Bodies that exercise every construct `bodyHtml` knows and every character the escapers touch: a blank
 * line between paragraphs, a bullet list, `**emphasis**`, the five HTML specials, a `</script>` that
 * `jsonForScript` must keep inside the string, and non-ASCII text.
 */
const body = (tag, extra = '') => ({
  title: `${tag} title & <more>`,
  whatItIs: `${tag} what it is: **plain** text with "quotes" and 'apostrophes'.${extra}`,
  why: `${tag} why — first paragraph.\n\nSecond paragraph of ${tag}, with a </script> inside.`,
  setup: `${tag} setup:\n\n- step **one**\n- step two <b>\n- step three`,
  usage: `${tag} usage — ü, ё, 日本語 — and a lone * asterisk.`,
  whatCanGoWrong: `${tag} what can go wrong.\n   \nA paragraph after a whitespace-only line.`,
});

const SYNTHETIC_ARTICLES = [
  { id: 'alpha', en: body('alpha en') },
  { id: 'beta', en: body('beta en') },
  { id: 'gamma', en: body('gamma en', ' A longer lead, so the index shows one.') },
  { id: PROMPTS_ARTICLE, en: body('prompts en') },
  { id: TWIN_ARTICLE, en: body('prompts en') },
];

/**
 * Partial on purpose: ru translates four of five (gamma falls back), uk one, de none, es all. The two
 * prompt twins are translated identically wherever one is, so their renders differ only in the appendix.
 */
const SYNTHETIC_TRANSLATIONS = {
  ru: { alpha: body('alpha ru'), beta: body('beta ru'), [PROMPTS_ARTICLE]: body('prompts ru'), [TWIN_ARTICLE]: body('prompts ru') },
  uk: { alpha: body('alpha uk') },
  de: {},
  es: { alpha: body('alpha es'), beta: body('beta es'), gamma: body('gamma es'), [PROMPTS_ARTICLE]: body('prompts es'), [TWIN_ARTICLE]: body('prompts es') },
};

/** The synthetic prompts: one role, one prompt with text the escaper must touch, one id with no text. */
const SYNTHETIC_PROMPTS = {
  groups: [{ role: 'Plan review & more', ids: ['plan-critique', 'absent'] }],
  texts: { 'plan-critique': 'Review the **plan** <carefully>.\n\n- say "why"\n- never </script>' },
};

/** The texts `bodyHtml` is recorded over on its own — the bodies above, plus the shapes a body may take. */
const BODY_HTML_SAMPLES = [
  '',
  '   ',
  'one line',
  'two\nlines in one paragraph',
  'first\n\nsecond\n\n\n\nthird',
  '- a\n- b',
  '- a\n\nnot a list',
  '- mixed\nwith a plain line',
  '**bold** and **two** and *single* and ** empty ** and **unclosed',
  '<b>&"\'</b>',
  'crlf\r\n\r\nparagraphs\r\n- and\r\n- bullets',
  ...SYNTHETIC_ARTICLES.flatMap((article) => Object.values(article.en)),
];

/** The renders recorded: every language at the theme's own size and tone, plus two off-centre pairs. */
const RENDERS = [
  ...['en', 'ru', 'uk', 'de', 'es'].map((language) => ({ language })),
  { language: 'en', uiScale: 2, textTone: -1 },
  { language: 'ru', uiScale: -5, textTone: 5 },
];

const translationModule = (constant, bodies) =>
  `import { HelpBody } from './helpContent';\nexport const ${constant}: Readonly<Record<string, HelpBody>> = ${JSON.stringify(bodies, null, 2)};\n`;

const promptsModule = () =>
  `export const PROMPT_TEXTS: Readonly<Record<string, string>> = ${JSON.stringify(SYNTHETIC_PROMPTS.texts, null, 2)};\n`
  + `export const PROMPT_GROUPS: readonly { readonly role: string; readonly ids: readonly string[] }[] = ${JSON.stringify(SYNTHETIC_PROMPTS.groups, null, 2)};\n`;

/** The one nonce a page carries: in the CSP and on its one script, and nowhere else. */
function nonceOf(html) {
  const csp = [...html.matchAll(/'nonce-([^']*)'/g)].map((m) => m[1]);
  const scripts = [...html.matchAll(/<script nonce="([^"]*)">/g)].map((m) => m[1]);
  const opens = html.match(/<script\b/g) ?? [];
  if (csp.length !== 1 || scripts.length !== 1 || opens.length !== 1 || csp[0] !== scripts[0]) {
    throw new Error(`expected one CSP nonce and one script carrying it; got csp=${JSON.stringify(csp)} scripts=${JSON.stringify(scripts)} opens=${opens.length}`);
  }

  return csp[0];
}

/**
 * The appendix as the difference between the prompts article and its twin: the twin's `data-article`
 * is renamed to the original's, then the common prefix and suffix are removed. Both renders must
 * reassemble from the three parts, or the derivation is refused.
 */
function appendixOf(withAppendix, twin) {
  const aligned = twin.replace(`data-article="${TWIN_ARTICLE}"`, `data-article="${PROMPTS_ARTICLE}"`);
  let prefix = 0;
  while (prefix < aligned.length && aligned[prefix] === withAppendix[prefix]) {
    prefix += 1;
  }
  let suffix = 0;
  while (suffix < aligned.length - prefix && aligned.at(-1 - suffix) === withAppendix.at(-1 - suffix)) {
    suffix += 1;
  }
  const appendix = withAppendix.slice(prefix, withAppendix.length - suffix);
  const reassembled = aligned.slice(0, prefix) + appendix + aligned.slice(prefix);
  if (prefix + suffix !== aligned.length || reassembled !== withAppendix || appendix.length === 0) {
    throw new Error('the prompts article and its twin differ in more than the appendix');
  }

  return appendix;
}

const modules = compileCoaiModules({
  coai,
  ref,
  sources: SOURCES,
  extra: {
    ...Object.fromEntries(
      Object.entries(MODULES).map(([language, [file, constant]]) => [`${file}.ts`, translationModule(constant, SYNTHETIC_TRANSLATIONS[language])]),
    ),
    'helpPrompts.ts': promptsModule(),
  },
});
try {
  const content = modules.load('helpContent');
  const descriptor = Object.getOwnPropertyDescriptor(content, 'HELP_ARTICLES');
  if (descriptor === undefined || descriptor.writable !== true) {
    throw new Error('helpContent.HELP_ARTICLES is not a writable export; the synthetic articles cannot be installed');
  }
  // The real ids the page must NOT carry — `prompts-in-full` is a real id on purpose (coai's appendix fires on it).
  const syntheticIds = SYNTHETIC_ARTICLES.map((article) => article.id);
  const realIds = content.HELP_ARTICLES.map((article) => article.id).filter((id) => !syntheticIds.includes(id));
  content.HELP_ARTICLES = SYNTHETIC_ARTICLES;
  const page = modules.load('helpPage');

  const out = {
    source: `dew_flow_connect_other_ais@${ref} src_vs_code/src/helpPage.ts (renderHelpHtml, searchIndex, articleHtml, bodyHtml) over helpContent.ts, webviewHtml.ts, zoomControl.ts, textTone.ts`,
    articles: SYNTHETIC_ARTICLES,
    translations: SYNTHETIC_TRANSLATIONS,
    prompts: SYNTHETIC_PROMPTS,
    promptsArticle: PROMPTS_ARTICLE,
    twinArticle: TWIN_ARTICLE,
    languages: [...content.HELP_LANGUAGES],
    appendix: {},
    searchIndex: {},
    articleHtml: {},
    bodyHtml: BODY_HTML_SAMPLES.map((text) => ({ text, html: page.bodyHtml(text) })),
    pages: [],
  };

  for (const language of content.HELP_LANGUAGES) {
    out.appendix[language] = appendixOf(page.articleHtml(PROMPTS_ARTICLE, language), page.articleHtml(TWIN_ARTICLE, language));
    out.searchIndex[language] = page.searchIndex(language);
    out.articleHtml[language] = Object.fromEntries(SYNTHETIC_ARTICLES.map((article) => [article.id, page.articleHtml(article.id, language)]));
  }

  for (const options of RENDERS) {
    const html = page.renderHelpHtml(options);
    if (!html.includes('data-open="alpha"') || realIds.some((id) => html.includes(`data-open="${id}"`))) {
      throw new Error('the rendered page does not carry the synthetic articles, or carries a real one');
    }
    out.pages.push({ ...options, nonce: nonceOf(html), html });
  }

  process.stdout.write(JSON.stringify(out, null, 2) + '\n');
} finally {
  modules.dispose();
}
