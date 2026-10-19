import { callable, id, list, oneOf, repeated, text } from './checks';
import { attributes, children, element, valueOf, writeValue, type KitDocument, type KitElement } from './dom';
import { matchesQuery, present, SORT_DIRECTIONS, sortedIndexes, type CellValue, type SortDirection } from './tableOrder';

/**
 * `DataTable` — sort by a header, search the shown text, reveal one row's hidden value on request
 * (`todo/PLAN_kit_components_storybook.md` §4.6).
 *
 * <p><b>The consumer owns every value and every word.</b> A column's `value(row)` is what sorts; its `format` is
 * what shows — units, rounding, a date in the reader's zone — and the kit formats nothing itself but absence, which
 * it shows as `—` and never hands to `format` (`common.coding-style`: absent is not zero).</p>
 *
 * <p><b>Sorting.</b> A sortable header is a `th scope=col` holding a `button type=button`; Enter and Space reach that
 * button as a click — the browser's own activation of a `<button>` — so the kit adds no key handler of its own (a
 * second one would sort twice). `aria-sort` says the sorted column's direction and `none` on the other sortable
 * ones. Rows are MOVED (re-appended), never rebuilt, so a revealed value and a focused button survive a sort.</p>
 *
 * <p><b>The reveal posts only an index, and the hidden text is never in the DOM before it is revealed.</b> A reveal
 * button calls `onReveal(index)` with ONE argument: the row's index in the `rows` the consumer gave — not its place
 * after a sort or a search. The kit never holds the hidden text until `reveal(index, text)` hands it over, and
 * `setRows` drops every revealed text, so a new row at index 3 never shows the old row 3's value.</p>
 */

export interface DataColumn<Row> {
  /** `[a-z][a-z0-9-]*`, unique among the columns. */
  readonly key: string;
  readonly header: string;
  /** What sorts: a number, a string, or `null` for absent. */
  readonly value: (row: Row) => CellValue;
  /** What shows, for a present value — the consumer's unit and rounding. `String(value)` when not given. */
  readonly format?: (value: string | number, row: Row) => string;
  /** `end` for numbers, so their digits line up. */
  readonly align?: 'start' | 'end';
  /** `false` keeps the header plain; sortable by default. */
  readonly sortable?: boolean;
}

export interface DataTableReveal<Row> {
  /** The reveal column's header. */
  readonly header: string;
  /**
   * The reveal button's accessible name for a row — say WHAT it reveals, and of which row. NEVER put the hidden value here:
   * this text is in the page before any reveal.
   */
  readonly button: (row: Row) => string;
  /**
   * Told the row's index in `rows` and an opaque REQUEST id - nothing about the row - when a person asks to reveal it. The
   * consumer hands the request back with its answer (`reveal(index, text, request)`); the id is unique per click for the life
   * of the table. A click on a button that is still waiting for its answer does nothing, so `onReveal` is told once.
   */
  readonly onReveal: (index: number, request: string) => void;
  /** The button's visible text; `Show` when absent. */
  readonly buttonText?: string;
  /** What the button says while it waits for the consumer's answer; `Waiting…` when absent. */
  readonly waitingText?: string;
}

export interface DataTableSort {
  readonly key: string;
  readonly direction: SortDirection;
}

/**
 * The table's own width below which each row stacks as "label: value" lines (`components.css` reads it through the
 * table's size container): `narrow` below 30em, `medium` 40em, `wide` 60em, `never` at no width. A table never scrolls
 * sideways whichever is chosen — `never` leaves it a table whose columns shrink and wrap.
 */
export const STACK_WIDTHS = ['narrow', 'medium', 'wide', 'never'] as const;

export type StackWidth = (typeof STACK_WIDTHS)[number];

const DEFAULT_STACK: StackWidth = 'medium';

export interface DataTableOptions<Row> {
  /** The table's accessible name. */
  readonly label: string;
  readonly columns: readonly DataColumn<Row>[];
  readonly rows: readonly Row[];
  /** A search box above the table, named `label`. */
  readonly search?: { readonly label: string };
  readonly reveal?: DataTableReveal<Row>;
  /** Shown in one row spanning every column when no row is shown. */
  readonly emptyText?: string;
  /** The status line under the search box; `Showing 3 of 10 rows.` when absent. */
  readonly countText?: (shown: number, total: number) => string;
  /** The order at first. */
  readonly sort?: DataTableSort;
  /** Below which width OF THE TABLE rows stack as "label: value" lines; `medium` when absent. */
  readonly stack?: StackWidth;
}

export interface DataTableView<E, Row> {
  readonly root: E;
  /**
   * Replaces the rows; every revealed value and every pending request is dropped, the sort and the search are kept. All or
   * nothing: the new rows are built first (a consumer's `value()` or `format()` can throw there), and a `setRows` that throws
   * leaves the table exactly as it was - rows, revealed texts, pending requests. A disposed table ignores it. One exception:
   * a `countText` that throws does so AFTER the rows were replaced (it runs in the repaint) - only the status line is stale
   * until the next repaint.
   */
  setRows(rows: readonly Row[]): void;
  /**
   * Shows `text` in row `index`'s reveal cell — the consumer's answer to an `onReveal(index, request)` — and answers `true`.
   * It applies only when `request` is the CURRENT pending request for that row in the current rows; then the request is spent.
   * A missing, unknown, older or already answered request, one from before `setRows`, a reply for a row that is not there any
   * more (the rows shrank) or a reply after `dispose()` changes nothing and answers `false`: a slow host reply must never land
   * on a new row (not even when the same row is clicked again), and must not crash the page. Refused with a `TypeError` - these
   * are programmer errors, not late replies: a table with no reveal column, an index that is not a whole number of 0 or more, a
   * text or a request that is not a string. A host that cannot answer should still answer, e.g.
   * `reveal(index, 'not available', request)`: the only other reset of a waiting row is `setRows` (or `dispose`).
   */
  reveal(index: number, text: string, request: string): boolean;
  sortBy(key: string, direction: SortDirection): void;
  /** Filters as the search box does, and shows the query in the box; a query that is not a string is a `TypeError`. */
  filter(query: string): void;
  /** The shown rows' indexes, in the order shown. */
  order(): number[];
  /**
   * Stops the table talking to the consumer: pending requests are dropped, `reveal` answers `false` (no throw, no change to the
   * page), a click on a reveal button tells nobody, and `setRows`, `sortBy` and `filter` do nothing. Call it when the page that
   * owns the table goes away; a late host reply or a late poll then cannot touch it, and a header click or a keystroke no
   * longer repaints it (so `countText` is never called again). Safe to call twice. It does not clear what is revealed: a consumer
   * that must clear revealed texts calls `setRows([])` BEFORE `dispose()`, or removes the root.
   */
  dispose(): void;
}

/** One rendered row: its element, the texts it shows (what the search reads), and its reveal cell. */
interface RowView<E> {
  readonly tr: E;
  readonly texts: readonly string[];
  readonly values: readonly CellValue[];
  readonly revealCell: E | undefined;
  /** The reveal button, which says it is waiting once it is pressed. */
  readonly revealButton: E | undefined;
  /** The text the consumer revealed for this row, searchable like any shown text; dropped with the row by `setRows`. */
  revealed: string | undefined;
}

/** The parts of the table the state paints. */
interface Parts<E> {
  readonly root: E;
  readonly tbody: E;
  readonly empty: E;
  readonly count: E | undefined;
  readonly search: E | undefined;
  readonly heads: ReadonlyMap<string, E>;
}

interface State<E, Row> {
  rows: readonly Row[];
  views: RowView<E>[];
  sort: DataTableSort | undefined;
  query: string;
  /** Row index -> the request a person made for it in the CURRENT rows and the consumer has not answered; `setRows` empties it. */
  readonly pending: Map<number, string>;
  /** How many times `setRows` has run: part of every request id, so an id never means two things. */
  generation: number;
  /** Requests made so far; never reset, so two clicks never share an id. */
  requests: number;
  /** Set by `dispose()`: the table no longer talks to the consumer. */
  disposed: boolean;
}

const ABSENT = '—';
const DEFAULT_EMPTY = 'No rows match.';
const DEFAULT_SHOW = 'Show';
const DEFAULT_WAITING = 'Waiting…';
const BUTTON_CLASS = 'kit-table__reveal-button';
const PENDING_CLASS = 'kit-table__reveal--pending';

const defaultCount = (shown: number, total: number): string => `Showing ${shown} of ${total} rows.`;

function checkedColumns<Row>(columns: readonly DataColumn<Row>[]): readonly DataColumn<Row>[] {
  const checked = list(columns, 'DataTable columns');
  const keys = checked.map((column, index) => id(column.key, `DataTable columns[${index}].key`));
  const twice = repeated(keys);
  if (twice !== undefined) {
    throw new TypeError(`DataTable columns: the key "${twice}" is used twice.`);
  }
  checked.forEach((column, index) => {
    text(column.header, `DataTable columns[${index}].header`);
    callable(column.value, `DataTable columns[${index}].value`);
  });

  return checked;
}

function checkedReveal<Row>(reveal: DataTableReveal<Row> | undefined): void {
  if (reveal !== undefined) {
    text(reveal.header, 'DataTable reveal.header');
    callable(reveal.button, 'DataTable reveal.button');
    callable(reveal.onReveal, 'DataTable reveal.onReveal');
  }
}

/** The options, checked at the door: every refusal names what. */
function checked<Row>(options: DataTableOptions<Row>): DataTableOptions<Row> {
  text(options.label, 'DataTable label');
  const columns = checkedColumns(options.columns);
  checkedRows(options.rows);
  checkedReveal(options.reveal);
  if (options.search !== undefined) {
    text(options.search.label, 'DataTable search.label');
  }
  if (options.sort !== undefined) {
    checkedSort(columns, options.sort.key, options.sort.direction);
  }

  return { ...options, stack: oneOf(options.stack ?? DEFAULT_STACK, STACK_WIDTHS, 'DataTable stack') };
}

function checkedRows<Row>(rows: readonly Row[]): readonly Row[] {
  if (!Array.isArray(rows)) {
    throw new TypeError('DataTable rows must be a list.');
  }

  return rows;
}

function checkedSort<Row>(columns: readonly DataColumn<Row>[], key: string, direction: SortDirection): DataTableSort {
  const sortable = columns.filter((column) => column.sortable !== false).map((column) => column.key);

  return { key: oneOf(key, sortable, 'DataTable sort key'), direction: oneOf(direction, SORT_DIRECTIONS, 'DataTable sort direction') };
}

/** One column's value for a row, refused when it is not a number, a string or `null`. */
function cellValue<Row>(column: DataColumn<Row>, row: Row): CellValue {
  const value: unknown = column.value(row);
  if (value === null || typeof value === 'string' || typeof value === 'number') {
    return value;
  }
  throw new TypeError(`DataTable column "${column.key}": value(row) must answer a number, a string or null, got ${typeof value}.`);
}

/** What a cell shows: `—` for absent, the consumer's format otherwise. */
function shown<Row>(column: DataColumn<Row>, value: CellValue, row: Row): string {
  if (!present(value)) {
    return ABSENT;
  }

  return column.format === undefined ? String(value) : column.format(value, row);
}

function cellClass<Row>(column: DataColumn<Row>): string {
  return column.align === 'end' ? 'kit-table__cell kit-table__cell--end' : 'kit-table__cell';
}

/** One row: a cell per column, then the reveal cell. */
function rowView<E extends KitElement<E>, Row>(doc: KitDocument<E>, options: DataTableOptions<Row>, row: Row, index: number, onAsk: (index: number) => void): RowView<E> {
  const values = options.columns.map((column) => cellValue(column, row));
  const texts = options.columns.map((column, at) => shown(column, values[at] ?? null, row));
  const tr = attributes(element(doc, 'tr', 'kit-table__row'), { 'data-kit-row': String(index) });
  options.columns.forEach((column, at) => { tr.appendChild(attributes(element(doc, 'td', cellClass(column), texts[at]), { 'data-kit-label': column.header })); });
  const reveal = options.reveal === undefined ? undefined : revealCellOf(doc, options.reveal, row, index, onAsk);
  if (reveal !== undefined) {
    tr.appendChild(reveal.cell);
  }

  return rowViewOf(tr, texts, values, reveal);
}

/** The row's parts as the state keeps them; a table with no reveal column has neither cell nor button. */
function rowViewOf<E>(tr: E, texts: readonly string[], values: readonly CellValue[], reveal: { cell: E; button: E } | undefined): RowView<E> {
  return { tr, texts, values, revealCell: reveal?.cell, revealButton: reveal?.button, revealed: undefined };
}

/** A reveal cell holding its button; the button asks for this row's index, and the consumer is told nothing else of the row. */
function revealCellOf<E extends KitElement<E>, Row>(doc: KitDocument<E>, reveal: DataTableReveal<Row>, row: Row, index: number, onAsk: (index: number) => void): { cell: E; button: E } {
  const button = attributes(element(doc, 'button', BUTTON_CLASS, reveal.buttonText ?? DEFAULT_SHOW), {
    type: 'button', 'aria-label': text(reveal.button(row), 'DataTable reveal.button(row)'), 'data-kit-reveal': String(index),
  });
  button.addEventListener('click', () => { onAsk(index); });

  return { cell: children(attributes(element(doc, 'td', 'kit-table__reveal'), { 'data-kit-label': reveal.header }), button), button };
}

/** A header: a sort button inside a `th scope=col aria-sort=none`, or plain text for a column that does not sort. */
function headOf<E extends KitElement<E>, Row>(doc: KitDocument<E>, column: DataColumn<Row>, onSort: (key: string) => void): E {
  const th = attributes(element(doc, 'th', column.align === 'end' ? 'kit-table__head kit-table__head--end' : 'kit-table__head'), { scope: 'col' });
  if (column.sortable === false) {
    th.textContent = column.header;
    return th;
  }
  th.setAttribute('aria-sort', 'none');
  const arrow = attributes(element(doc, 'span', 'kit-table__arrow'), { 'aria-hidden': 'true' });
  const button = attributes(element(doc, 'button', 'kit-table__sort'), { type: 'button', 'data-kit-sort': column.key });
  children(button, element(doc, 'span', 'kit-table__sort-label', column.header), arrow);
  button.addEventListener('click', () => { onSort(column.key); });

  return children(th, button);
}

/** The table element with its header row; the sortable heads keyed by column. */
function tableOf<E extends KitElement<E>, Row>(doc: KitDocument<E>, options: DataTableOptions<Row>, onSort: (key: string) => void): { table: E; tbody: E; heads: Map<string, E> } {
  const heads = new Map<string, E>();
  const headRow = element(doc, 'tr', 'kit-table__head-row');
  for (const column of options.columns) {
    const head = headOf(doc, column, onSort);
    headRow.appendChild(head);
    if (column.sortable !== false) {
      heads.set(column.key, head);
    }
  }
  if (options.reveal !== undefined) {
    headRow.appendChild(attributes(element(doc, 'th', 'kit-table__head', options.reveal.header), { scope: 'col' }));
  }
  const tbody = element(doc, 'tbody', 'kit-table__body');
  const table = gridOf(doc, options);

  return { table: children(table, children(element(doc, 'thead', 'kit-table__header'), headRow), tbody), tbody, heads };
}

/** The empty `table`, carrying its accessible name and the class that picks its stacked layout. */
function gridOf<E extends KitElement<E>, Row>(doc: KitDocument<E>, options: DataTableOptions<Row>): E {
  const stack = options.stack ?? DEFAULT_STACK;

  return attributes(element(doc, 'table', `kit-table__grid kit-table--stack-${stack}`), { 'aria-label': options.label });
}

/** The search box and its status line, when the consumer asked for a search. */
function searchOf<E extends KitElement<E>, Row>(doc: KitDocument<E>, options: DataTableOptions<Row>, onQuery: (query: string) => void): { search: E; count: E } | undefined {
  if (options.search === undefined) {
    return undefined;
  }
  const search = attributes(element(doc, 'input', 'kit-table__search'), { type: 'search', 'aria-label': options.search.label, 'data-kit-search': '' });
  search.addEventListener('input', () => { onQuery(valueOf(search)); });
  const count = attributes(element(doc, 'div', 'kit-table__count'), { role: 'status' });

  return { search, count };
}

function emptyRowOf<E extends KitElement<E>, Row>(doc: KitDocument<E>, options: DataTableOptions<Row>): E {
  const span = options.columns.length + (options.reveal === undefined ? 0 : 1);
  const cell = attributes(element(doc, 'td', 'kit-table__empty-cell', text(options.emptyText ?? DEFAULT_EMPTY, 'DataTable emptyText')), { colspan: String(span) });

  return children(attributes(element(doc, 'tr', 'kit-table__empty'), { 'data-kit-empty': '' }), cell);
}

/** The row order the state asks for: sorted by the sort column, or as given. */
function ordered<E, Row>(state: State<E, Row>, columns: readonly DataColumn<Row>[]): number[] {
  const sort = state.sort;
  const at = sort === undefined ? -1 : columns.findIndex((column) => column.key === sort.key);
  if (sort === undefined || at < 0) {
    return state.views.map((_view, index) => index);
  }

  return sortedIndexes(state.views.map((view) => view.values[at] ?? null), sort.direction);
}

/** What the search reads for a row: the texts it shows, and the text the consumer revealed for it. */
function searchable<E>(view: RowView<E> | undefined): readonly string[] {
  return view === undefined ? [] : [...view.texts, ...(view.revealed === undefined ? [] : [view.revealed])];
}

/** The rows of an already computed `order` that the search keeps, in that order. */
function kept<E, Row>(state: State<E, Row>, order: readonly number[]): number[] {
  return order.filter((index) => matchesQuery(searchable(state.views[index]), state.query));
}

/** Re-appends the rows in order (moving them), hides the ones the search leaves out, then the empty row last. */
function paintRows<E extends KitElement<E>, Row>(parts: Parts<E>, state: State<E, Row>, order: readonly number[], shownRows: ReadonlySet<number>): void {
  order.forEach((index) => {
    const view = state.views[index];
    if (view !== undefined) {
      view.tr.hidden = !shownRows.has(index);
      parts.tbody.appendChild(view.tr);
    }
  });
  parts.empty.hidden = shownRows.size > 0;
  parts.tbody.appendChild(parts.empty);
}

/** `aria-sort` and the arrow on every sortable head. */
function paintHeads<E extends KitElement<E>>(parts: Parts<E>, sort: DataTableSort | undefined): void {
  for (const [key, head] of parts.heads) {
    paintHead(head, sort?.key === key ? sort.direction : undefined);
  }
}

/** One sortable head: its direction, or `none`. */
function paintHead<E extends KitElement<E>>(head: E, direction: SortDirection | undefined): void {
  head.setAttribute('aria-sort', direction ?? 'none');
  head.className = headClass(head.className, direction);
}

/** A head's class with the sort-state modifier replaced. */
function headClass(current: string, direction: SortDirection | undefined): string {
  const base = current.split(/\s+/).filter((name) => name.length > 0 && !name.startsWith('kit-table__head--sorted'));

  return [...base, ...(direction === undefined ? [] : [`kit-table__head--sorted-${direction}`])].join(' ');
}

export function createDataTable<E extends KitElement<E>, Row>(doc: KitDocument<E>, options: DataTableOptions<Row>): DataTableView<E, Row> {
  const spec = checked(options);
  const state: State<E, Row> = { rows: [], views: [], sort: spec.sort, query: '', pending: new Map(), generation: 0, requests: 0, disposed: false };
  // A disposed table repaints nothing, so a header click or a keystroke cannot reach the consumer's `countText` either.
  const repaint = (): void => {
    if (!state.disposed) {
      paint(parts, state, spec);
    }
  };
  const onSort = (key: string): void => {
    const direction: SortDirection = state.sort?.key === key && state.sort.direction === 'ascending' ? 'descending' : 'ascending';
    state.sort = { key, direction };
    repaint();
  };
  const { table, tbody, heads } = tableOf(doc, spec, onSort);
  const searchParts = searchOf(doc, spec, (query) => { state.query = query; repaint(); });
  const root = element(doc, 'div', 'kit-table');
  if (searchParts !== undefined) {
    children(root, searchParts.search, searchParts.count);
  }
  const parts: Parts<E> = { root: children(root, table), tbody, empty: emptyRowOf(doc, spec), count: searchParts?.count, search: searchParts?.search, heads };
  // A click makes a REQUEST, recorded BEFORE the consumer hears of it so its answer can find it; `load` empties them. A button
  // that is already waiting does nothing: one question per row at a time.
  const ask = (index: number): void => {
    if (!state.disposed && !state.pending.has(index)) {
      state.requests += 1;
      const request = `${state.generation}:${state.requests}`;
      state.pending.set(index, request);
      markWaiting(state, spec, index);
      spec.reveal?.onReveal(index, request);
    }
  };
  // All or nothing: every row view is built FIRST - that is where a consumer's value() or format() can throw - and only then are
  // the old rows, revealed texts and pending requests replaced, so a throw leaves the table exactly as it was.
  const load = (rows: readonly Row[]): void => {
    const views = checkedRows(rows).map((row, index) => rowView(doc, spec, row, index, ask));
    tbody.textContent = '';
    state.rows = rows;
    state.views = views;
    state.generation += 1;
    state.pending.clear();
    repaint();
  };
  load(spec.rows);

  return view(parts, state, spec, { load, repaint });
}

/** Paints heads, rows and the count from the state. */
function paint<E extends KitElement<E>, Row>(parts: Parts<E>, state: State<E, Row>, spec: DataTableOptions<Row>): void {
  const order = ordered(state, spec.columns);
  const shownRows = new Set(kept(state, order));
  paintHeads(parts, state.sort);
  paintRows(parts, state, order, shownRows);
  if (parts.count !== undefined) {
    parts.count.textContent = (spec.countText ?? defaultCount)(shownRows.size, state.views.length);
  }
}

/** The handle a consumer keeps. */
function view<E extends KitElement<E>, Row>(parts: Parts<E>, state: State<E, Row>, spec: DataTableOptions<Row>, ops: { load(rows: readonly Row[]): void; repaint(): void }): DataTableView<E, Row> {
  return {
    root: parts.root,
    setRows: (rows) => { if (!state.disposed) { ops.load(rows); } },
    reveal: (index, revealed, request) => revealRow(state, spec, index, { revealed, request }, ops.repaint),
    sortBy: (key, direction) => {
      const sort = checkedSort(spec.columns, key, direction);
      if (!state.disposed) {
        state.sort = sort;
        ops.repaint();
      }
    },
    filter: (query) => {
      const checkedText = checkedQuery(query);
      if (!state.disposed) {
        state.query = checkedText;
        if (parts.search !== undefined) {
          writeValue(parts.search, state.query);
        }
        ops.repaint();
      }
    },
    order: () => kept(state, ordered(state, spec.columns)),
    dispose: () => {
      state.disposed = true;
      state.pending.clear();
    },
  };
}

/** The pressed button says it waits: the consumer's `waitingText`, and a class the stylesheet mutes. */
function markWaiting<E extends KitElement<E>, Row>(state: State<E, Row>, spec: DataTableOptions<Row>, index: number): void {
  const button = rowAt(state, index)?.revealButton;
  if (button !== undefined) {
    button.textContent = waitingLabel(spec.reveal);
    button.className = `${BUTTON_CLASS} ${PENDING_CLASS}`;
  }
}

/** What a waiting button says: the consumer's `waitingText`, else the English default. */
function waitingLabel<Row>(reveal: DataTableReveal<Row> | undefined): string {
  return reveal?.waitingText ?? DEFAULT_WAITING;
}

/** The revealed text: a string, or a `TypeError` naming what it was. */
function checkedRevealed(revealed: unknown): void {
  if (typeof revealed !== 'string') {
    throw new TypeError(`DataTable reveal: the revealed text must be a string, got ${typeof revealed}.`);
  }
}

/** Whether `request` is the row's CURRENT pending request; an absent request is never current. */
function isCurrent<E, Row>(state: State<E, Row>, index: number, request: string | undefined): boolean {
  return request !== undefined && state.pending.get(index) === request;
}

/** A reply's request: a string, absent (`undefined` - then no request can match), or a `TypeError` naming what it was. */
function checkedRequest(request: unknown): string | undefined {
  if (request !== undefined && typeof request !== 'string') {
    throw new TypeError(`DataTable reveal: the request must be a string, got ${request === null ? 'null' : typeof request}.`);
  }

  return request;
}

/** The arguments of a reveal that no honest consumer gets wrong: refused with a TypeError naming what (a late reply is NOT one of them). */
function checkedAnswer<Row>(spec: DataTableOptions<Row>, index: number, answer: { revealed: unknown; request: unknown }): void {
  if (spec.reveal === undefined) {
    throw new TypeError('DataTable reveal: this table has no reveal column.');
  }
  checkedIndex(index);
  checkedRevealed(answer.revealed);
  checkedRequest(answer.request);
}

/** A row index: a whole number of 0 or more, or a `TypeError`. Whether a row has that index NOW is another question (a late reply). */
function checkedIndex(index: unknown): void {
  if (typeof index !== 'number' || !Number.isInteger(index) || index < 0) {
    throw new TypeError(`DataTable reveal: the index must be a whole number, 0 or more, got ${String(index)}.`);
  }
}

/** The row a reply may fill - the table is alive and `request` is the row's CURRENT one - or `undefined`: a late reply, answered false. */
function pendingRow<E, Row>(state: State<E, Row>, index: number, request: string | undefined): RowView<E> | undefined {
  return !state.disposed && isCurrent(state, index, request) ? rowAt(state, index) : undefined;
}

/**
 * The consumer's answer to `onReveal(index, request)`: the text goes into THAT row's reveal cell, and nowhere else, and only for
 * the row's CURRENT request. A reply that is late - from before `setRows` (even when the same row was clicked again), for a row
 * that is gone, spent, unknown or after `dispose()` - answers false and changes nothing: it is never an error.
 */
function revealRow<E extends KitElement<E>, Row>(state: State<E, Row>, spec: DataTableOptions<Row>, index: number, answer: { revealed: string; request: string | undefined }, repaint: () => void): boolean {
  checkedAnswer(spec, index, answer);
  const row = pendingRow(state, index, answer.request);
  if (row?.revealCell === undefined) {
    return false;
  }
  state.pending.delete(index);
  row.revealCell.textContent = answer.revealed;
  row.revealCell.className = 'kit-table__reveal kit-table__reveal--shown';
  row.revealed = answer.revealed;
  repaint();

  return true;
}

/** A search query: a string, or a `TypeError` naming the type it was. */
function checkedQuery(query: unknown): string {
  if (typeof query !== 'string') {
    throw new TypeError(`DataTable filter: the query must be a string, got ${query === null ? 'null' : typeof query}.`);
  }

  return query;
}

/** Row `index` when it is a whole number naming a row; otherwise `undefined`. */
function rowAt<E, Row>(state: State<E, Row>, index: number): RowView<E> | undefined {
  return Number.isInteger(index) ? state.views[index] : undefined;
}
