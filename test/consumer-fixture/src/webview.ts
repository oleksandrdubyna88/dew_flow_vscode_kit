/**
 * The consumer's WEBVIEW entry (research/PLAN_kit_components_storybook.md §5.2, item 24): what wsl_care's
 * `src/webview/fullView.ts` will be — the components and their stylesheet, imported from the INSTALLED package's
 * subpaths, bundled by esbuild for the browser. Type-checked with the DOM library (`tsconfig.webview.json`): the real
 * `document` is passed with no cast, and what the components return is the page's own `HTMLElement`.
 */
import {
  STATUS_TONES,
  createDataTable,
  createRecommendationCard,
  createTabs,
  type DataColumn,
} from '@oleksandrdubyna88/vscode-webview-kit/components';
import '@oleksandrdubyna88/vscode-webview-kit/components.css';

interface Row {
  readonly name: string;
  readonly size: number | null;
}

const rows: readonly Row[] = [
  { name: 'beta', size: 10 },
  { name: 'alpha', size: null },
  { name: 'gamma', size: 9 },
];

const columns: readonly DataColumn<Row>[] = [
  { key: 'name', header: 'Name', value: (row) => row.name },
  { key: 'size', header: 'Size', value: (row) => row.size, format: (value) => `${String(value)} units`, align: 'end' },
];

const revealed: number[] = [];
const table = createDataTable(document, {
  label: 'Fixture rows',
  columns,
  rows,
  search: { label: 'Search the rows' },
  reveal: { header: 'Detail', button: (row) => `Show the detail of ${row.name}`, onReveal: (index) => { revealed.push(index); } },
});

const action: HTMLButtonElement = document.createElement('button');
action.type = 'button';
action.textContent = 'Act';
const card = createRecommendationCard(document, { tone: 'warning', word: 'Warning', sentence: 'Something to do.', action, evidence: ['A measured fact'] });

const tabs = createTabs(document, {
  idPrefix: 'fixture',
  label: 'Fixture sections',
  tabs: [
    { id: 'table', label: 'Table', content: table.root },
    { id: 'card', label: 'Card', content: card, status: { tone: STATUS_TONES[3], word: 'One warning' } },
  ],
});

const root: HTMLElement = tabs.root;
document.body.appendChild(root);

/** What run-webview.mjs drives after the bundle ran. */
(globalThis as { kitFixture?: unknown }).kitFixture = { tabs, table, revealed };
