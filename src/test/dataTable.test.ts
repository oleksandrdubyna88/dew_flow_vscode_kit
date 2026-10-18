import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { createDataTable, type DataTableOptions } from '../components/dataTable';
import type { KitElement } from '../components/dom';
import { compareCells, matchesQuery, sortedIndexes } from '../components/tableOrder';
import { onEveryDocument, type DomNode, type Driver } from './domDrivers';
import { GALLERY } from './gallery';

/**
 * `DataTable`, RUN on the strict fake and on jsdom (`todo/PLAN_kit_components_storybook.md` §5.2, items 7–13): the
 * headers, the sort and `aria-sort`, absent values, the consumer's formats, the search, the reveal — which tells
 * the consumer an index and nothing else, and never shows a hidden value before the consumer hands it over — and
 * every refusal.
 */

interface Proc {
  readonly pid: number;
  readonly program: string;
  readonly held: number | null;
  /** The redacted command line: the consumer keeps it; no column reads it. */
  readonly secret: string;
}

const ROWS: readonly Proc[] = [
  { pid: 10, program: 'node', held: 14_680_064, secret: 'SECRET-node --token=aaa' },
  { pid: 9, program: 'claude', held: null, secret: 'SECRET-claude --resume=bbb' },
  { pid: 300, program: 'dotnet', held: 1_048_576, secret: 'SECRET-dotnet build ccc' },
  { pid: 2, program: 'Bash', held: 14_680_064, secret: 'SECRET-bash -c ddd' },
];

const mib = (bytes: number): string => `${(bytes / 1_048_576).toFixed(1)} MiB`;

function options(overrides: Partial<DataTableOptions<Proc>> = {}, revealed: number[][] = []): DataTableOptions<Proc> {
  return {
    label: 'Processes',
    columns: [
      { key: 'pid', header: 'PID', value: (row) => row.pid, align: 'end' },
      { key: 'program', header: 'Program', value: (row) => row.program },
      { key: 'held', header: 'Held', value: (row) => row.held, format: (value) => mib(Number(value)), align: 'end' },
      { key: 'note', header: 'Note', value: () => 'n/a', sortable: false },
    ],
    rows: ROWS,
    search: { label: 'Search processes' },
    reveal: {
      header: 'Command line',
      button: (row) => `Show the command line of ${row.program}`,
      onReveal: (...args: number[]) => { revealed.push(args); },
    },
    ...overrides,
  };
}

/** The programs of the shown rows, top to bottom. */
function programs(root: DomNode): string[] {
  return root.all('tr.kit-table__row').filter((row) => !row.hidden).map((row) => row.all('td')[1]?.text ?? '');
}

function head(root: DomNode, key: string): DomNode {
  return root.all('th').filter((th) => th.all(`button[data-kit-sort="${key}"]`).length === 1)[0] ?? assert.fail(`no head for ${key}`);
}

onEveryDocument(<E extends KitElement<E>>(make: () => Driver<E>, name: string) => {
  describe(`DataTable on the ${name}`, () => {
    test('a sortable header is th[scope=col][aria-sort=none] holding a button[type=button]; a non-sortable one has neither', () => {
      const driver = make();
      const root = driver.attach(createDataTable(driver.doc, options()).root);
      assert.equal(root.one('table').attribute('aria-label'), 'Processes');
      const heads = root.all('th');
      assert.deepEqual(heads.map((th) => th.attribute('scope')), ['col', 'col', 'col', 'col', 'col']);
      assert.deepEqual(heads.map((th) => th.attribute('aria-sort')), ['none', 'none', 'none', null, null]);
      assert.deepEqual(heads.map((th) => th.all('button[type="button"]').length), [1, 1, 1, 0, 0]);
      assert.equal(heads[3]?.text, 'Note');
      assert.equal(heads[4]?.text, 'Command line');
    });

    test('a click sorts ascending, a second descending; aria-sort follows and is none on every other sortable column', () => {
      const driver = make();
      const root = driver.attach(createDataTable(driver.doc, options()).root);
      driver.click(head(root, 'program').one('button'));
      assert.deepEqual(programs(root), ['Bash', 'claude', 'dotnet', 'node']);
      assert.deepEqual(['pid', 'program', 'held'].map((key) => head(root, key).attribute('aria-sort')), ['none', 'ascending', 'none']);
      driver.click(head(root, 'program').one('button'));
      assert.deepEqual(programs(root), ['node', 'dotnet', 'claude', 'Bash']);
      assert.equal(head(root, 'program').attribute('aria-sort'), 'descending');
      driver.click(head(root, 'pid').one('button'));
      assert.deepEqual(['pid', 'program', 'held'].map((key) => head(root, key).attribute('aria-sort')), ['ascending', 'none', 'none']);
    });

    test('numbers sort numerically (9 before 10, 300 last), absent sorts LAST both ways and shows as —, ties keep the given order', () => {
      const driver = make();
      const view = createDataTable(driver.doc, options());
      const root = driver.attach(view.root);
      view.sortBy('pid', 'ascending');
      assert.deepEqual(programs(root), ['Bash', 'claude', 'node', 'dotnet']);
      view.sortBy('held', 'ascending');
      assert.deepEqual(programs(root), ['dotnet', 'node', 'Bash', 'claude']);
      view.sortBy('held', 'descending');
      assert.deepEqual(programs(root), ['node', 'Bash', 'dotnet', 'claude'], 'absent first when descending, or a tie reordered');
      const claude = root.all('tr.kit-table__row').find((row) => row.all('td')[1]?.text === 'claude');
      assert.equal(claude?.all('td')[2]?.text, '—');
    });

    test('format shapes a present value in the consumer\'s unit, and is never called with an absent one', () => {
      const driver = make();
      const seen: unknown[] = [];
      const base = options();
      const columns = base.columns.map((column) => (column.key === 'held' ? { ...column, format: (value: string | number) => { seen.push(value); return mib(Number(value)); } } : column));
      const root = driver.attach(createDataTable(driver.doc, { ...base, columns }).root);
      assert.deepEqual(root.all('tr.kit-table__row').map((row) => row.all('td')[2]?.text), ['14.0 MiB', '—', '1.0 MiB', '14.0 MiB']);
      assert.ok(!seen.includes(null), 'format was handed null');
      assert.equal(seen.length, 3);
      assert.equal(root.all('td.kit-table__cell--end').length, 8, 'the two end-aligned columns, four rows each');
    });

    test('the search hides rows whose SHOWN text does not hold the query, case-insensitively; the status counts; no hit shows the empty row once', () => {
      const driver = make();
      const root = driver.attach(createDataTable(driver.doc, options({ emptyText: 'No process matches.' })).root);
      const box = root.one('input[type="search"]');
      assert.equal(box.attribute('aria-label'), 'Search processes');
      assert.equal(root.one('[role="status"]').text, 'Showing 4 of 4 rows.');
      driver.type(box, '  CLAU ');
      assert.deepEqual(programs(root), ['claude']);
      assert.equal(root.one('[role="status"]').text, 'Showing 1 of 4 rows.');
      assert.equal(root.one('tr.kit-table__empty').hidden, true);
      driver.type(box, '14.0 mib');
      assert.deepEqual(programs(root), ['node', 'Bash'], 'the search reads the FORMATTED cell');
      driver.type(box, 'zzz');
      assert.deepEqual(programs(root), []);
      const empty = root.one('tr.kit-table__empty');
      assert.equal(empty.hidden, false);
      assert.equal(empty.text, 'No process matches.');
      assert.equal(empty.one('td').attribute('colspan'), '5');
      assert.equal(root.one('[role="status"]').text, 'Showing 0 of 4 rows.');
      driver.type(box, 'SECRET');
      assert.deepEqual(programs(root), [], 'the search found a value no column shows');
    });

    test('filter() from code filters and shows the query in the box; countText words the status', () => {
      const driver = make();
      const view = createDataTable(driver.doc, options({ countText: (shown, total) => `${shown}/${total}` }));
      const root = driver.attach(view.root);
      view.filter('node');
      assert.deepEqual(view.order(), [0]);
      assert.equal(root.one('[role="status"]').text, '1/4');
    });

    test('before any reveal, no hidden value is anywhere in the table\'s text', () => {
      const driver = make();
      const root = driver.attach(createDataTable(driver.doc, options()).root);
      assert.ok(!root.text.includes('SECRET'), root.text);
      const buttons = root.all('button[data-kit-reveal]');
      assert.deepEqual(buttons.map((button) => button.attribute('aria-label')), ROWS.map((row) => `Show the command line of ${row.program}`));
      assert.deepEqual(buttons.map((button) => button.text), ['Show', 'Show', 'Show', 'Show']);
    });

    test('a reveal click tells onReveal ONE argument — the row\'s index in the given rows, even after a sort and a search moved it', () => {
      const driver = make();
      const revealed: number[][] = [];
      const view = createDataTable(driver.doc, options({}, revealed));
      const root = driver.attach(view.root);
      view.sortBy('pid', 'descending');
      driver.type(root.one('input[type="search"]'), 'o');
      assert.deepEqual(programs(root), ['dotnet', 'node']);
      const first = root.all('tr.kit-table__row').filter((row) => !row.hidden)[0];
      driver.click(first?.one('button[data-kit-reveal]') ?? assert.fail('no reveal button'));
      assert.deepEqual(revealed, [[2]], 'not the display position 0: dotnet is row 2 of the given rows');
    });

    test('reveal(index, text) fills that row\'s cell only; setRows drops every revealed value', () => {
      const driver = make();
      const view = createDataTable(driver.doc, options());
      const root = driver.attach(view.root);
      view.sortBy('program', 'descending');
      driver.click(root.one('tr[data-kit-row="2"]').one('button[data-kit-reveal]'));
      assert.equal(view.reveal(2, ROWS[2]?.secret ?? ''), true);
      const holding = root.all('tr.kit-table__row').filter((row) => row.text.includes('SECRET'));
      assert.equal(holding.length, 1);
      assert.equal(holding[0]?.attribute('data-kit-row'), '2');
      assert.equal(holding[0]?.one('td.kit-table__reveal').text, 'SECRET-dotnet build ccc');
      assert.equal(holding[0]?.all('button[data-kit-reveal]').length, 0);
      view.setRows(ROWS.map((row) => ({ ...row, program: `${row.program}2` })));
      assert.ok(!root.text.includes('SECRET'), 'a new row 2 shows the old row 2\'s value');
      assert.equal(root.all('tr.kit-table__row').length, 4);
      assert.equal(head(root, 'program').attribute('aria-sort'), 'descending', 'setRows lost the sort');
      assert.deepEqual(programs(root), ['node2', 'dotnet2', 'claude2', 'Bash2']);
    });


    /** A person asks to reveal row `index` of the rows the consumer gave. */
    function ask(driver: Driver<E>, root: DomNode, index: number): void {
      driver.click(root.one(`tr[data-kit-row="${index}"]`).one('button[data-kit-reveal]'));
    }

    test('reveal(index, text) applies only to a row a person ASKED for in the current rows: no click, or a click before setRows, answers false and changes nothing', () => {
      const driver = make();
      const view = createDataTable(driver.doc, options());
      const root = driver.attach(view.root);
      assert.equal(view.reveal(1, 'SECRET-unasked'), false, 'a reveal nobody asked for was applied');
      assert.ok(!root.text.includes('SECRET'), 'an unasked reveal reached the DOM');
      ask(driver, root, 3);
      view.setRows(ROWS.map((row) => ({ ...row, program: `${row.program}2` })));
      assert.equal(view.reveal(3, 'SECRET-late-reply'), false, 'a late reply landed on a NEW row 3');
      assert.ok(!root.text.includes('SECRET'), 'the old row 3\'s secret is on the new row 3');
      assert.equal(root.all('button[data-kit-reveal]').length, 4, 'a refused reveal replaced a button');
      ask(driver, root, 3);
      assert.equal(view.reveal(3, 'SECRET-answered'), true);
      assert.equal(root.all('tr.kit-table__row').filter((row) => row.text.includes('SECRET-answered')).length, 1);
      assert.equal(view.reveal(3, 'SECRET-twice'), false, 'one click answered twice');
      assert.ok(!root.text.includes('SECRET-twice'));
    });

    test('a revealed value is searchable, and setRows drops it from the search with the rest of it', () => {
      const driver = make();
      const view = createDataTable(driver.doc, options());
      const root = driver.attach(view.root);
      ask(driver, root, 2);
      view.filter('ccc');
      assert.deepEqual(view.order(), [], 'the hidden value was searchable before it was revealed');
      view.reveal(2, ROWS[2]?.secret ?? '');
      assert.deepEqual(view.order(), [2], 'the revealed value is not searched');
      assert.deepEqual(programs(root), ['dotnet']);
      view.setRows(ROWS);
      assert.deepEqual(view.order(), [], 'setRows kept the revealed text in the search');
    });

    test('the gallery\'s "revealed" case really shows its revealed text - a press, then the consumer\'s reply - on this document too', () => {
      const driver = make();
      const entry = GALLERY.find((component) => component.id === 'dataTable')?.cases.find((candidate) => candidate.id === 'revealed') ?? assert.fail('no gallery case dataTable/revealed');
      assert.equal(entry.kind, 'dom');
      const root = driver.attach(entry.kind === 'dom' ? entry.render(driver.doc) : assert.fail('not a DOM case'));
      assert.equal(root.all('td.kit-table__reveal--shown').length, 1, 'no revealed cell: the case\'s press did not reach the table');
      assert.ok(root.text.includes('charlie --detail=shown-only-on-request'));
      assert.equal(root.all('button[data-kit-reveal]').length, 3, 'the other three rows keep their buttons');
    });
    test('filter(query) refuses a non-string naming the type; the search box still passes its string', () => {
      const driver = make();
      const view = createDataTable(driver.doc, options());
      const root = driver.attach(view.root);
      assert.throws(() => { view.filter(5 as never); }, (error: unknown) => error instanceof TypeError && /DataTable filter: the query must be a string, got number/.test(error.message));
      assert.throws(() => { view.filter(undefined as never); }, /the query must be a string, got undefined/);
      driver.type(root.one('input[type="search"]'), 'node');
      assert.deepEqual(view.order(), [0]);
    });
    /** Each shown-or-hidden body row's cells' labels, row by row. */
    function labels(root: DomNode): (string | null)[][] {
      return root.all('tr.kit-table__row').map((row) => row.all('td').map((cell) => cell.attribute('data-kit-label')));
    }

    test('every body cell carries data-kit-label = its column header — the reveal cell too — and still does after setRows, a sort and a search; the empty row carries none', () => {
      const driver = make();
      const view = createDataTable(driver.doc, options({ emptyText: 'No process matches.' }));
      const root = driver.attach(view.root);
      const expected = ['PID', 'Program', 'Held', 'Note', 'Command line'];
      assert.deepEqual(labels(root), ROWS.map(() => expected));
      view.sortBy('program', 'descending');
      view.filter('o');
      view.setRows([...ROWS, { pid: 1, program: 'zsh', held: 5, secret: 'SECRET-zsh' }]);
      driver.click(root.one('tr[data-kit-row="0"]').one('button[data-kit-reveal]'));
      assert.equal(view.reveal(0, 'shown only now'), true);
      assert.deepEqual(labels(root), [...ROWS, ROWS[0]].map(() => expected));
      view.filter('zzz');
      assert.equal(root.one('tr.kit-table__empty').one('td').attribute('data-kit-label'), null, 'the empty row must show no label');
      assert.deepEqual(root.one('tr.kit-table__empty').all('td').map((cell) => cell.attribute('data-kit-label')), [null], 'the empty row is one cell with no label');
    });

    test('stack defaults to medium; each of the four values adds its class to the table; an unknown one is refused naming all four', () => {
      const driver = make();
      const stackClass = (stack?: 'narrow' | 'medium' | 'wide' | 'never'): string[] => {
        const root = driver.attach(createDataTable(driver.doc, options(stack === undefined ? {} : { stack })).root);
        return root.one('table').classes.filter((name) => name.startsWith('kit-table--stack'));
      };
      assert.deepEqual(stackClass(), ['kit-table--stack-medium']);
      for (const stack of ['narrow', 'medium', 'wide', 'never'] as const) {
        assert.deepEqual(stackClass(stack), [`kit-table--stack-${stack}`]);
      }
      assert.throws(
        () => createDataTable(driver.doc, options({ stack: 'huge' as never })),
        (error: unknown) => error instanceof TypeError && /DataTable stack must be one of narrow, medium, wide, never, got "huge"/.test(error.message),
      );
    });

    test('refused, each naming what: no columns, a repeated or malformed key, an empty header or label, a bad sort, a reveal without a column or outside the rows, a non-string revealed text, a value that is not a cell value', () => {
      const driver = make();
      const base = options();
      const first = base.columns[0] ?? assert.fail('no column');
      const cases: [Partial<DataTableOptions<Proc>>, RegExp][] = [
        [{ columns: [] }, /DataTable columns must be a non-empty list/],
        [{ columns: [first, first] }, /the key "pid" is used twice/],
        [{ columns: [{ ...first, key: 'Pid' }] }, /columns\[0\]\.key must match/],
        [{ columns: [{ ...first, header: '' }] }, /columns\[0\]\.header must be non-empty text/],
        [{ label: ' ' }, /DataTable label must be non-empty text/],
        [{ sort: { key: 'note', direction: 'ascending' } }, /sort key must be one of pid, program, held, got "note"/],
        [{ sort: { key: 'pid', direction: 'up' as never } }, /sort direction must be one of ascending, descending/],
        [{ columns: [{ ...first, value: () => true as never }] }, /column "pid": value\(row\) must answer a number, a string or null, got boolean/],
        [{ rows: 'x' as never }, /DataTable rows must be a list/],
        [{ search: { label: '' } }, /search\.label must be non-empty text/],
      ];
      for (const [overrides, message] of cases) {
        assert.throws(() => createDataTable(driver.doc, { ...base, ...overrides }), (error: unknown) => error instanceof TypeError && message.test(error.message), String(message));
      }
      const view = createDataTable(driver.doc, base);
      assert.throws(() => { view.reveal(4, 'x'); }, /there is no row 4; the rows are 0 to 3/);
      assert.throws(() => { view.reveal(1.5, 'x'); }, /there is no row 1.5/);
      assert.throws(() => { view.reveal(0, 7 as never); }, /must be a string, got number/);
      const { reveal: _reveal, ...withoutReveal } = base;
      assert.throws(() => { createDataTable(driver.doc, withoutReveal).reveal(0, 'x'); }, /this table has no reveal column/);
      assert.throws(() => { view.sortBy('note', 'ascending'); }, /sort key must be one of pid, program, held/);
    });
  });
});

test('the order, as pure functions: absent last both ways, NaN absent, numbers before text, the collator\'s numeric order, ties by index', () => {
  assert.deepEqual(sortedIndexes([3, null, 1, Number.NaN, 2], 'ascending'), [2, 4, 0, 1, 3]);
  assert.deepEqual(sortedIndexes([3, null, 1, Number.NaN, 2], 'descending'), [0, 4, 2, 1, 3]);
  assert.deepEqual(sortedIndexes(['file10', 'file9', 'File1'], 'ascending'), [2, 1, 0]);
  assert.deepEqual(sortedIndexes(['b', 2, 'a', 1], 'ascending'), [3, 1, 2, 0]);
  assert.deepEqual(sortedIndexes([Infinity, -Infinity, Infinity, 0], 'ascending'), [1, 3, 0, 2]);
  assert.deepEqual(sortedIndexes([1, 1, 1], 'descending'), [0, 1, 2]);
  assert.equal(compareCells(null, null, 'descending'), 0);
  assert.equal(matchesQuery(['Alpha', 'beta'], '  ALP '), true);
  assert.equal(matchesQuery(['Alpha'], 'z'), false);
  assert.equal(matchesQuery([], '   '), true);
});
