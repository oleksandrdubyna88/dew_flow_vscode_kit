import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { createDataTable, type DataTableOptions } from '../components/dataTable';
import type { KitElement } from '../components/dom';
import { compareCells, matchesQuery, sortedIndexes } from '../components/tableOrder';
import { onEveryDocument, type DomNode, type Driver } from './domDrivers';
import { GALLERY } from './gallery';

/**
 * `DataTable`, RUN on the strict fake and on jsdom (`research/PLAN_kit_components_storybook.md` §5.2, items 7–13): the
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

function options(overrides: Partial<DataTableOptions<Proc>> = {}, revealed: unknown[][] = []): DataTableOptions<Proc> {
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
      onReveal: (...args: unknown[]) => { revealed.push(args); },
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

    test('a reveal click tells onReveal the row\'s index in the given rows - even after a sort and a search moved it - and an opaque request id, and NOTHING of the row', () => {
      const driver = make();
      const log: unknown[][] = [];
      const view = createDataTable(driver.doc, options({}, log));
      const root = driver.attach(view.root);
      view.sortBy('pid', 'descending');
      driver.type(root.one('input[type="search"]'), 'o');
      assert.deepEqual(programs(root), ['dotnet', 'node']);
      const first = root.all('tr.kit-table__row').filter((row) => !row.hidden)[0];
      driver.click(first?.one('button[data-kit-reveal]') ?? assert.fail('no reveal button'));
      assert.equal(log.length, 1);
      assert.equal(log[0]?.length, 2, 'onReveal must get exactly the index and the request');
      assert.equal(log[0]?.[0], 2, 'not the display position 0: dotnet is row 2 of the given rows');
      const request = log[0]?.[1];
      assert.equal(typeof request, 'string');
      for (const value of [...Object.values(ROWS[2] ?? {}), 'dotnet', 'SECRET']) {
        assert.ok(!String(request).includes(String(value)), `the request "${String(request)}" carries row data "${String(value)}"`);
      }
    });

    test('reveal(index, text, request) fills that row\'s cell only; setRows drops every revealed value', () => {
      const driver = make();
      const log: unknown[][] = [];
      const view = createDataTable(driver.doc, options({}, log));
      const root = driver.attach(view.root);
      view.sortBy('program', 'descending');
      const request = ask(driver, root, 2, log);
      assert.equal(view.reveal(2, ROWS[2]?.secret ?? '', request), true);
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

    /** A person asks to reveal row `index` of the rows the consumer gave; answers the request id the consumer was told. */
    function ask(driver: Driver<E>, root: DomNode, index: number, log: unknown[][]): string {
      const before = log.length;
      driver.click(root.one(`tr[data-kit-row="${index}"]`).one('button[data-kit-reveal]'));
      assert.equal(log.length, before + 1, 'the click did not reach onReveal');
      const request = log[log.length - 1]?.[1];
      assert.equal(typeof request, 'string', 'onReveal got no request id');

      return String(request);
    }

    test('reveal answers true only for the CURRENT request of a row a person asked about: no request, an unknown one, an old one, one answered already - all false, nothing changes', () => {
      const driver = make();
      const log: unknown[][] = [];
      const view = createDataTable(driver.doc, options({}, log));
      const root = driver.attach(view.root);
      assert.equal(view.reveal(1, 'SECRET-unasked', 'x:1'), false, 'a reveal nobody asked for was applied');
      assert.equal(view.reveal(1, 'SECRET-unasked', undefined as never), false, 'a missing request was applied');
      assert.ok(!root.text.includes('SECRET'), 'an unasked reveal reached the DOM');
      const request = ask(driver, root, 3, log);
      assert.equal(view.reveal(3, 'SECRET-no-request', undefined as never), false, 'a reply with no request was applied');
      assert.equal(view.reveal(3, 'SECRET-other-request', `${request}-other`), false, 'a reply with another request was applied');
      assert.equal(view.reveal(1, 'SECRET-wrong-row', request), false, 'a request answered for another row was applied');
      assert.ok(!root.text.includes('SECRET'), 'a refused reply reached the DOM');
      assert.equal(view.reveal(3, 'SECRET-answered', request), true);
      assert.equal(root.all('tr.kit-table__row').filter((row) => row.text.includes('SECRET-answered')).length, 1);
      assert.equal(view.reveal(3, 'SECRET-twice', request), false, 'one request answered twice');
      assert.ok(!root.text.includes('SECRET-twice'));
    });

    test('a late reply for a click made BEFORE setRows never lands - not even when the same row is clicked again after it: only the second request is accepted', () => {
      const driver = make();
      const log: unknown[][] = [];
      const view = createDataTable(driver.doc, options({}, log));
      const root = driver.attach(view.root);
      const firstRequest = ask(driver, root, 2, log);
      view.setRows(ROWS.map((row) => ({ ...row, program: `${row.program}2` })));
      assert.equal(view.reveal(2, 'SECRET-old', firstRequest), false, 'a reply from before setRows was applied');
      assert.ok(!root.text.includes('SECRET-old'));
      assert.equal(root.all('button[data-kit-reveal]').length, 4, 'a refused reveal replaced a button');
      const secondRequest = ask(driver, root, 2, log);
      assert.notEqual(secondRequest, firstRequest, 'two clicks shared a request id');
      assert.equal(view.reveal(2, 'SECRET-old', firstRequest), false, 'the FIRST reply was accepted for the second click of the same row');
      assert.ok(!root.text.includes('SECRET-old'), 'the old reply is in a cell');
      assert.equal(view.reveal(2, 'SECRET-new', secondRequest), true);
      assert.equal(root.all('tr.kit-table__row').filter((row) => row.text.includes('SECRET-new')).length, 1);
      assert.ok(!root.text.includes('SECRET-old'));
    });

    test('a click on a button that is waiting does nothing - onReveal is told once - the button says Waiting... with a pending class, the revealed text replaces it, and setRows resets it', () => {
      const driver = make();
      const log: unknown[][] = [];
      const view = createDataTable(driver.doc, options({}, log));
      const root = driver.attach(view.root);
      const button = (): DomNode => root.one('tr[data-kit-row="1"]').one('button[data-kit-reveal]');
      assert.equal(button().text, 'Show');
      assert.ok(!button().classes.includes('kit-table__reveal--pending'));
      const request = ask(driver, root, 1, log);
      assert.equal(button().text, 'Waiting…');
      assert.ok(button().classes.includes('kit-table__reveal--pending'), 'no pending class on the waiting button');
      driver.click(button());
      driver.click(button());
      assert.equal(log.length, 1, 'a click while waiting told the consumer again');
      assert.equal(view.reveal(1, 'SECRET-claude', request), true);
      assert.equal(root.all('tr.kit-table__row').filter((row) => row.text.includes('Waiting')).length, 0);
      assert.equal(root.one('tr[data-kit-row="1"]').one('td.kit-table__reveal').text, 'SECRET-claude');
      ask(driver, root, 2, log);
      assert.equal(root.one('tr[data-kit-row="2"]').one('button[data-kit-reveal]').text, 'Waiting…');
      view.setRows(ROWS);
      assert.equal(root.all('button[data-kit-reveal]').filter((candidate) => candidate.text !== 'Show').length, 0, 'setRows left a button waiting');
      assert.ok(root.all('button[data-kit-reveal]').every((candidate) => !candidate.classes.includes('kit-table__reveal--pending')));
      ask(driver, root, 2, log);
      assert.equal(log.length, 3, 'a row waiting before setRows blocked the same row afterwards');
    });

    test('the consumer can say what a waiting button says (waitingText), and the English default is "Waiting…"', () => {
      const driver = make();
      const log: unknown[][] = [];
      const reveal = { ...(options().reveal ?? assert.fail('no reveal')), waitingText: 'Wait a moment', onReveal: (...args: unknown[]) => { log.push(args); } };
      const view = createDataTable(driver.doc, options({ reveal }, log));
      const root = driver.attach(view.root);
      ask(driver, root, 0, log);
      assert.equal(root.one('tr[data-kit-row="0"]').one('button[data-kit-reveal]').text, 'Wait a moment');
    });

    test('a revealed value is searchable, and setRows drops it from the search with the rest of it', () => {
      const driver = make();
      const log: unknown[][] = [];
      const view = createDataTable(driver.doc, options({}, log));
      const root = driver.attach(view.root);
      const request = ask(driver, root, 2, log);
      view.filter('ccc');
      assert.deepEqual(view.order(), [], 'the hidden value was searchable before it was revealed');
      view.reveal(2, ROWS[2]?.secret ?? '', request);
      assert.deepEqual(view.order(), [2], 'the revealed value is not searched');
      assert.deepEqual(programs(root), ['dotnet']);
      view.setRows(ROWS);
      assert.deepEqual(view.order(), [], 'setRows kept the revealed text in the search');
    });

    test('the gallery\'s "revealed" case really shows its revealed text AND a waiting button - a press, then the consumer\'s reply for one row only - on this document too', () => {
      const driver = make();
      const entry = GALLERY.find((component) => component.id === 'dataTable')?.cases.find((candidate) => candidate.id === 'revealed') ?? assert.fail('no gallery case dataTable/revealed');
      assert.equal(entry.kind, 'dom');
      const root = driver.attach(entry.kind === 'dom' ? entry.render(driver.doc) : assert.fail('not a DOM case'));
      assert.equal(root.all('td.kit-table__reveal--shown').length, 1, 'no revealed cell: the case\'s press did not reach the table');
      assert.ok(root.text.includes('charlie --detail=shown-only-on-request'));
      assert.equal(root.all('button[data-kit-reveal]').length, 3, 'the other three rows keep their buttons');
      assert.equal(root.all('button.kit-table__reveal--pending').length, 1, 'no waiting button in the case');
    });

    test('a late reply after setRows SHRANK the rows answers false - it never throws "there is no row" - and no secret reaches the DOM', () => {
      const driver = make();
      const log: unknown[][] = [];
      const view = createDataTable(driver.doc, options({}, log));
      const root = driver.attach(view.root);
      const request = ask(driver, root, 3, log);
      view.setRows(ROWS.slice(0, 2));
      assert.equal(view.reveal(3, 'SECRET-late', request), false, 'a reply for a row that is gone must answer false');
      assert.equal(view.reveal(7, 'SECRET-never-there', 'x:1'), false, 'a reply for a row that never existed must answer false');
      assert.ok(!root.text.includes('SECRET'), 'a late reply reached the DOM');
      assert.equal(root.all('tr.kit-table__row').length, 2);
    });

    /** Columns whose `value()` blows up for the row with pid 666 - what a consumer's own code can do to a `setRows`. */
    function fragileColumns(): DataTableOptions<Proc>['columns'] {
      return [
        { key: 'pid', header: 'PID', value: (row) => { if (row.pid === 666) { throw new Error('value() blew up'); } return row.pid; }, align: 'end' },
        { key: 'program', header: 'Program', value: (row) => row.program },
      ];
    }

    test('setRows is all-or-nothing: a value() that throws for a NEW row leaves the table exactly as it was - rows, revealed text, pending requests, sort - and an old secret does not come back or get lost', () => {
      const driver = make();
      const log: unknown[][] = [];
      const view = createDataTable(driver.doc, options({ columns: fragileColumns() }, log));
      const root = driver.attach(view.root);
      const revealedRequest = ask(driver, root, 2, log);
      assert.equal(view.reveal(2, ROWS[2]?.secret ?? '', revealedRequest), true);
      const waitingRequest = ask(driver, root, 1, log);
      view.sortBy('program', 'descending');
      const before = programs(root);
      assert.throws(() => { view.setRows([...ROWS, { pid: 666, program: 'boom', held: 1, secret: 'SECRET-boom' }]); }, /value\(\) blew up/);
      assert.equal(root.all('tr.kit-table__row').length, 4, 'a failed setRows emptied or changed the table');
      assert.deepEqual(programs(root), before, 'a failed setRows reordered the table');
      assert.equal(root.all('tr.kit-table__row').filter((row) => row.text.includes('SECRET-dotnet build ccc')).length, 1, 'the revealed secret was lost');
      assert.ok(!root.text.includes('SECRET-boom'));
      view.sortBy('program', 'ascending');
      assert.equal(root.all('tr.kit-table__row').filter((row) => row.text.includes('SECRET')).length, 1, 'a later repaint brought a secret back or lost it');
      assert.equal(view.reveal(1, 'SECRET-claude', waitingRequest), true, 'a failed setRows dropped a pending request');
    });

    test('dispose(): pending requests are dropped, reveal answers false without a throw or a DOM change, a click on a reveal button tells nobody, setRows/sortBy/filter do nothing - and a wrong argument is still a TypeError', () => {
      const driver = make();
      const log: unknown[][] = [];
      const view = createDataTable(driver.doc, options({}, log));
      const root = driver.attach(view.root);
      const request = ask(driver, root, 2, log);
      view.dispose();
      assert.equal(view.reveal(2, 'SECRET-after-dispose', request), false, 'a reply after dispose was applied');
      assert.ok(!root.text.includes('SECRET'), 'a reply after dispose reached the DOM');
      const asked = log.length;
      driver.click(root.one('tr[data-kit-row="0"]').one('button[data-kit-reveal]'));
      assert.equal(log.length, asked, 'a click on a reveal button after dispose told the consumer');
      const order = programs(root);
      view.setRows(ROWS.map((row) => ({ ...row, program: `${row.program}2` })));
      view.sortBy('pid', 'descending');
      view.filter('zzz');
      assert.deepEqual(programs(root), order, 'setRows, sortBy or filter changed a disposed table');
      assert.deepEqual(view.order(), [0, 1, 2, 3]);
      view.dispose();
      assert.throws(() => { view.reveal(0, 7 as never, 'r'); }, /must be a string, got number/);
    });

    test('after dispose() a header sort click and a search keystroke neither repaint nor call the consumer\'s countText, and aria-sort stays', () => {
      const driver = make();
      let calls = 0;
      const view = createDataTable(driver.doc, options({ countText: (shown, total) => { calls += 1; return `${shown}/${total}`; } }));
      const root = driver.attach(view.root);
      view.dispose();
      calls = 0;
      driver.click(head(root, 'pid').one('button'));
      driver.type(root.one('input[type="search"]'), 'node');
      assert.equal(calls, 0, 'a disposed table still called countText');
      assert.equal(head(root, 'pid').attribute('aria-sort'), 'none', 'a header click sorted a disposed table');
      assert.deepEqual(programs(root), ['node', 'claude', 'dotnet', 'Bash'], 'a keystroke filtered a disposed table');
    });

    test('an onReveal that throws leaves the row clickable: its request is dropped (a reply with it answers false), the button is back to Show without the pending class, the error reaches the click, and a second click asks again', () => {
      const driver = make();
      const log: unknown[][] = [];
      let calls = 0;
      const reveal = { ...(options().reveal ?? assert.fail('no reveal')), onReveal: (...args: unknown[]) => { calls += 1; log.push(args); if (calls === 1) { throw new Error('the consumer broke'); } } };
      const view = createDataTable(driver.doc, options({ reveal }));
      const root = driver.attach(view.root);
      const button = (): DomNode => root.one('tr[data-kit-row="1"]').one('button[data-kit-reveal]');
      try {
        driver.click(button());
      } catch {
        // the dispatch of a click may surface the consumer's error; the STATE is what is asserted
      }
      assert.equal(calls, 1, 'the click did not reach onReveal');
      assert.equal(button().text, 'Show', 'the button kept saying it was waiting');
      assert.ok(!button().classes.includes('kit-table__reveal--pending'), 'the pending class stayed on the button');
      assert.equal(view.reveal(1, 'SECRET-claude', String(log[0]?.[1])), false, 'the request of a failed click was still pending');
      assert.ok(!root.text.includes('SECRET'));
      driver.click(button());
      assert.equal(calls, 2, 'a second click did not ask again');
      assert.equal(button().text, 'Waiting…');
      assert.equal(view.reveal(1, 'SECRET-claude', String(log[1]?.[1])), true);
    });

    test('reveal.onReveal must be a function at construction: a TypeError naming it', () => {
      const driver = make();
      const reveal = { ...(options().reveal ?? assert.fail('no reveal')), onReveal: 'nope' as never };
      assert.throws(() => createDataTable(driver.doc, options({ reveal })), (error: unknown) => error instanceof TypeError && /DataTable reveal\.onReveal must be a function, got/.test(error.message));
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
      const log: unknown[][] = [];
      const view = createDataTable(driver.doc, options({ emptyText: 'No process matches.' }, log));
      const root = driver.attach(view.root);
      const expected = ['PID', 'Program', 'Held', 'Note', 'Command line'];
      assert.deepEqual(labels(root), ROWS.map(() => expected));
      view.sortBy('program', 'descending');
      view.filter('o');
      view.setRows([...ROWS, { pid: 1, program: 'zsh', held: 5, secret: 'SECRET-zsh' }]);
      const request = ask(driver, root, 0, log);
      assert.equal(view.reveal(0, 'shown only now', request), true);
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
      assert.equal(view.reveal(4, 'x', 'r'), false, 'a reply for a row that is not there is a late reply: false, never a throw');
      assert.throws(() => { view.reveal(1.5, 'x', 'r'); }, /the index must be a whole number, 0 or more, got 1.5/);
      assert.throws(() => { view.reveal(-1, 'x', 'r'); }, /the index must be a whole number, 0 or more, got -1/);
      assert.throws(() => { view.reveal(Number.NaN, 'x', 'r'); }, /the index must be a whole number, 0 or more, got NaN/);
      assert.throws(() => { view.reveal(0, 7 as never, 'r'); }, /must be a string, got number/);
      assert.throws(() => { view.reveal(0, 'x', 7 as never); }, /the request must be a string, got number/);
      const { reveal: _reveal, ...withoutReveal } = base;
      assert.throws(() => { createDataTable(driver.doc, withoutReveal).reveal(0, 'x', 'r'); }, /this table has no reveal column/);
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
