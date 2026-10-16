import { createDataTable, STACK_WIDTHS, type DataTableOptions } from '../../components/dataTable';
import { children, element, type KitDocument, type KitElement } from '../../components/dom';
import { createRecommendationCard } from '../../components/recommendationCard';
import { STATUS_TONES } from '../../components/status';
import { createTabs, type TabSpec } from '../../components/tabs';
import { createDisplayConfig } from '../../display/config';
import { toneControlHtml, toneCss } from '../../display/tone';
import { ZOOM_CSS, zoomControlHtml } from '../../display/zoom';
import { createCatalog } from '../../help/catalog';
import { digestOf } from '../../help/digest';
import { renderHelpPage } from '../../help/page';
import type { HelpArticle, HelpBody, HelpLanguage } from '../../help/types';

/**
 * THE GALLERY — every component × state, once (`todo/PLAN_kit_components_storybook.md` §4.9). One source of truth
 * read three ways: the Storybook shows each case as a story (`stories/*.stories.ts`, held equal to this list by
 * `src/test/stories.test.ts`), `src/test/axe.test.ts` runs axe over each, and `src/test/componentsCss.test.ts`
 * checks every class each one renders has a rule. Test code: it never ships (`tsconfig.build.json` leaves
 * `src/test` out). The sample data is made up and generic — the components know no domain.
 */

/** A component state built with the kit's components in any document. */
export interface DomCase {
  readonly kind: 'dom';
  readonly id: string;
  readonly title: string;
  /** scope makes element ids unique when one page shows a case many times (the Storybook's matrix). */
  render<E extends KitElement<E>>(doc: KitDocument<E>, scope?: string): E;
}

/** A markup fragment from an existing string renderer (the display controls), with the CSS it is shown with. */
export interface HtmlCase {
  readonly kind: 'html';
  readonly id: string;
  readonly title: string;
  readonly html: string;
  readonly css: string;
}

/** A whole page from an existing renderer (the Help viewer). */
export interface PageCase {
  readonly kind: 'page';
  readonly id: string;
  readonly title: string;
  readonly html: string;
}

export type GalleryCase = DomCase | HtmlCase | PageCase;

export interface GalleryComponent {
  readonly id: string;
  readonly title: string;
  readonly cases: readonly GalleryCase[];
}

// ---- Tabs -------------------------------------------------------------------------------------------------

const panel = <E extends KitElement<E>>(doc: KitDocument<E>, text: string): E => element(doc, 'p', 'gallery-panel', text);

function tabs<E extends KitElement<E>>(doc: KitDocument<E>, scope: string | undefined, specs: readonly Omit<TabSpec<E>, 'content'>[], selected?: string): E {
  const withContent = specs.map((spec) => ({ ...spec, content: panel(doc, `The ${spec.label} panel.`) }));

  return createTabs(doc, { idPrefix: scope ?? 'gallery', label: 'Sections', tabs: withContent, ...(selected === undefined ? {} : { selected }) }).root;
}

const TABS: readonly GalleryCase[] = [
  { kind: 'dom', id: 'default', title: 'Default', render: (doc, scope) => tabs(doc, scope, [{ id: 'one', label: 'Overview' }, { id: 'two', label: 'Details' }, { id: 'three', label: 'History' }]) },
  {
    kind: 'dom', id: 'every-tone', title: 'A status on every tab', render: (doc, scope) => tabs(doc, scope, STATUS_TONES.map((tone) => ({ id: tone, label: `Area ${tone}`, status: { tone, word: `${tone} word` } }))),
  },
  { kind: 'dom', id: 'second-selected', title: 'Second tab selected', render: (doc, scope) => tabs(doc, scope, [{ id: 'one', label: 'Overview' }, { id: 'two', label: 'Details', status: { tone: 'warning', word: '2 warnings' } }, { id: 'three', label: 'History' }], 'two') },
  {
    kind: 'dom', id: 'many', title: 'Many tabs, long labels', render: (doc, scope) => tabs(doc, scope, Array.from({ length: 8 }, (_unused, index) => ({ id: `tab-${index}`, label: `A rather long section label number ${index + 1}` }))),
  },
];

// ---- DataTable ----------------------------------------------------------------------------------------------

interface Sample {
  readonly name: string;
  readonly size: number | null;
  readonly count: number;
}

const SAMPLES: readonly Sample[] = [
  { name: 'alpha', size: 14_680_064, count: 9 },
  { name: 'Bravo', size: null, count: 10 },
  { name: 'charlie', size: 1_048_576, count: 300 },
  { name: 'delta', size: 524_288, count: 2 },
];

const mebibytes = (value: string | number): string => `${(Number(value) / 1_048_576).toFixed(1)} MiB`;

function tableOptions(overrides: Partial<DataTableOptions<Sample>> = {}): DataTableOptions<Sample> {
  return {
    label: 'Samples',
    columns: [
      { key: 'name', header: 'Name', value: (row) => row.name },
      { key: 'size', header: 'Size', value: (row) => row.size, format: mebibytes, align: 'end' },
      { key: 'count', header: 'Count', value: (row) => row.count, align: 'end' },
    ],
    rows: SAMPLES,
    search: { label: 'Search samples' },
    reveal: { header: 'Detail', button: (row) => `Show the detail of ${row.name}`, onReveal: () => undefined },
    emptyText: 'No sample matches.',
    ...overrides,
  };
}

/** Eight columns of made-up text and numbers — more than a narrow box can show side by side. */
const WIDE_KEYS = ['name', 'owner', 'state', 'region', 'age', 'size', 'count', 'note'] as const;

type WideRow = Readonly<Record<(typeof WIDE_KEYS)[number], string | number>>;

const WIDE_ROWS: readonly WideRow[] = [
  { name: 'alpha', owner: 'team-one', state: 'running', region: 'north', age: 12, size: 4096, count: 9, note: 'first sample' },
  { name: 'bravo', owner: 'team-two', state: 'stopped', region: 'south', age: 3, size: 65_536, count: 10, note: 'second sample, a little longer' },
];

function wideOptions(): DataTableOptions<WideRow> {
  return {
    label: 'Wide samples',
    columns: WIDE_KEYS.map((key) => ({ key, header: `${key[0]?.toUpperCase() ?? ''}${key.slice(1)}`, value: (row: WideRow) => row[key], align: typeof WIDE_ROWS[0]?.[key] === 'number' ? 'end' as const : 'start' as const })),
    rows: WIDE_ROWS,
    search: { label: 'Search wide samples' },
  };
}

const LONG_PATH = '/mnt/c/Users/someone/projects/a-long-folder-name/node_modules/.pnpm/some-package-with-a-long-name@1.2.3/node_modules/some-package/lib/index.js';

const TABLE: readonly GalleryCase[] = [
  { kind: 'dom', id: 'unsorted', title: 'Unsorted', render: (doc) => createDataTable(doc, tableOptions()).root },
  { kind: 'dom', id: 'sorted-ascending', title: 'Sorted ascending', render: (doc) => createDataTable(doc, tableOptions({ sort: { key: 'count', direction: 'ascending' } })).root },
  { kind: 'dom', id: 'sorted-descending', title: 'Sorted descending, absent last', render: (doc) => createDataTable(doc, tableOptions({ sort: { key: 'size', direction: 'descending' } })).root },
  {
    kind: 'dom', id: 'searched', title: 'Searched', render: (doc) => {
      const view = createDataTable(doc, tableOptions());
      view.filter('a');
      return view.root;
    },
  },
  {
    kind: 'dom', id: 'searched-none', title: 'Searched, no hit', render: (doc) => {
      const view = createDataTable(doc, tableOptions());
      view.filter('zzz');
      return view.root;
    },
  },
  {
    kind: 'dom', id: 'revealed', title: 'One row revealed', render: (doc) => {
      const view = createDataTable(doc, tableOptions());
      view.reveal(2, 'charlie --detail=shown-only-on-request');
      return view.root;
    },
  },
  { kind: 'dom', id: 'plain', title: 'No search, no reveal', render: (doc) => createDataTable(doc, { label: 'Samples', columns: tableOptions().columns, rows: SAMPLES }).root },
  { kind: 'dom', id: 'empty', title: 'No rows', render: (doc) => createDataTable(doc, tableOptions({ rows: [] })).root },
  // The cases that would break "a table fits its box" (todo/PLAN_kit_components_storybook.md §4.6a, §5.2 item 27) —
  // `scripts/layout-check.mjs` renders each at three widths, four themes and three sizes, in the page and in a narrow box.
  { kind: 'dom', id: 'eight-columns', title: 'Eight columns in an 18em box', render: (doc) => children(element(doc, 'div', 'gallery-narrow'), createDataTable(doc, wideOptions()).root) },
  { kind: 'dom', id: 'unbreakable-cell', title: 'A long path with no space in a cell', render: (doc) => createDataTable(doc, tableOptions({ rows: [{ name: LONG_PATH, size: 1_048_576, count: 1 }, ...SAMPLES] })).root },
  { kind: 'dom', id: 'long-header', title: 'A long header', render: (doc) => createDataTable(doc, tableOptions({ columns: [{ key: 'name', header: 'The name this sample was given when it was first recorded', value: (row) => row.name }, ...tableOptions().columns.slice(1)] })).root },
  ...STACK_WIDTHS.map((stack): GalleryCase => ({
    kind: 'dom', id: `stack-${stack}`, title: `Stacks ${stack === 'never' ? 'never' : `below the ${stack} width`}`, render: (doc) => createDataTable(doc, tableOptions({ stack })).root,
  })),
];

// ---- RecommendationCard ----------------------------------------------------------------------------------

function actionButton<E extends KitElement<E>>(doc: KitDocument<E>): E {
  const button = element(doc, 'button', 'gallery-action', 'Apply the remedy');
  button.setAttribute('type', 'button');

  return button;
}

const CARDS: readonly GalleryCase[] = [
  ...STATUS_TONES.map((tone): GalleryCase => ({
    kind: 'dom', id: tone, title: `Tone ${tone}`, render: (doc) => createRecommendationCard(doc, {
      tone, word: `${tone[0]?.toUpperCase() ?? ''}${tone.slice(1)}`, sentence: `A ${tone} sentence that says what to do and why.`, evidence: ['First measured fact', 'Second measured fact'],
    }),
  })),
  {
    kind: 'dom', id: 'with-action', title: 'With its one button', render: (doc) => createRecommendationCard(doc, {
      tone: 'warning', word: 'Warning', sentence: 'Free some space before the next run.', action: actionButton(doc), evidence: ['Space left 6 %'], evidenceLabel: 'Why',
    }),
  },
  { kind: 'dom', id: 'sentence-only', title: 'Sentence only', render: (doc) => createRecommendationCard(doc, { tone: 'ok', word: 'All within limits', sentence: 'Nothing needs doing.' }) },
];

// ---- the existing parts: display controls and the Help viewer ------------------------------------------------

const DISPLAY = createDisplayConfig('Kit Storybook', 'kit');

const DISPLAY_CASES: readonly GalleryCase[] = [-5, 0, 5].map((offset) => ({
  kind: 'html', id: offset < 0 ? 'smallest-dimmest' : offset > 0 ? 'largest-brightest' : 'theme-default', title: `Offset ${offset}`,
  html: `<div class="gallery-controls">${zoomControlHtml(offset, DISPLAY)}${toneControlHtml(offset, DISPLAY)}</div>`,
  css: `${ZOOM_CSS}${toneCss(DISPLAY)}`,
}));

const helpBody = (tag: string): HelpBody => ({
  title: `${tag}: getting started`, whatItIs: `${tag} — what it is.`, why: `${tag} — why it exists.`, setup: `${tag} — how to set it up.`, usage: `${tag} — how to use it.`, whatCanGoWrong: `${tag} — what can go wrong.`,
});
const FIRST: HelpArticle = { id: 'first', en: helpBody('First') };
const SECOND: HelpArticle = { id: 'second', en: helpBody('Second') };
const HELP = createCatalog({
  articles: [FIRST, SECOND],
  translations: {
    ru: { bodies: { first: helpBody('Первая'), second: helpBody('Вторая') }, from: { first: digestOf(FIRST.en), second: digestOf(helpBody('Second, before an edit')) } },
    de: { bodies: { first: helpBody('Erste') }, from: { first: digestOf(FIRST.en) } },
  },
});
/** A fixed nonce: the gallery renders, it does not serve — the host mints one per render (`help/panel.ts`). */
export const GALLERY_NONCE = 'R2FsbGVyeU5vbmNlRm9yU3Rvcnlib29r';

const helpPage = (language: HelpLanguage): string => renderHelpPage({ catalog: HELP, language, display: DISPLAY, nonce: GALLERY_NONCE });

const HELP_CASES: readonly GalleryCase[] = [
  { kind: 'page', id: 'english', title: 'English', html: helpPage('en') },
  { kind: 'page', id: 'translated-and-stale', title: 'Russian: one fresh, one stale translation', html: helpPage('ru') },
  { kind: 'page', id: 'fallback', title: 'German: one translation, one English fallback', html: helpPage('de') },
];

export const GALLERY: readonly GalleryComponent[] = [
  { id: 'tabs', title: 'Tabs', cases: TABS },
  { id: 'dataTable', title: 'DataTable', cases: TABLE },
  { id: 'recommendationCard', title: 'RecommendationCard', cases: CARDS },
  { id: 'displayControls', title: 'Display controls', cases: DISPLAY_CASES },
  { id: 'helpViewer', title: 'Help viewer', cases: HELP_CASES },
];

/** One case, by component and case id — what a story is made from. */
export function galleryCase(component: string, id: string): GalleryCase {
  const found = GALLERY.find((entry) => entry.id === component)?.cases.find((entry) => entry.id === id);
  if (found === undefined) {
    throw new Error(`gallery: there is no case ${component}/${id}`);
  }

  return found;
}

/** Wraps a rendered state in a labelled block — how the matrix shows many states on one page. */
export function framed<E extends KitElement<E>>(doc: KitDocument<E>, label: string, content: E): E {
  return children(element(doc, 'div', 'gallery-frame'), element(doc, 'p', 'gallery-frame__label', label), content);
}
