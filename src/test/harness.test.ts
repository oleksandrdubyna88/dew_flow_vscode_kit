import assert from 'node:assert/strict';
import { test } from 'node:test';

import { assertNoCr } from './lineEndings';
import { Node, runPageScript } from './pageHarness';

/**
 * The harness is code under test: a permissive fake turns a suite green for the wrong reason
 * (`common.generated-code-tests` § 3), so its contract is pinned here before any page script leans on it.
 */

/**
 * The error `node:vm` raises when the deadline runs out. It is minted in the PAGE's realm — measured on
 * node 24.18 (2026-10-02): `instanceof Error` is false out here even though its constructor is named
 * `Error` — so it is read by its `code`, which it carries as an own property.
 */
function isDeadline(error: unknown): boolean {
  return typeof error === 'object' && error !== null
    && 'code' in error && error.code === 'ERR_SCRIPT_EXECUTION_TIMEOUT';
}

/**
 * An error raised INSIDE the page is the other realm's: neither `instanceof ReferenceError` nor even
 * `instanceof Object` holds for it out here, so it is read by name and message alone.
 */
function isReferenceErrorFor(name: string): (error: unknown) => boolean {
  return (error) => typeof error === 'object' && error !== null
    && 'name' in error && error.name === 'ReferenceError'
    && 'message' in error && error.message === `${name} is not defined`;
}

test('a page script that never returns fails by the deadline instead of hanging the suite', () => {
  assert.throws(() => runPageScript('while (true) {}'), isDeadline);
});

test('a handler that never returns fails by the same deadline when the test dispatches into it', () => {
  const button = new Node({}, 'BUTTON');
  runPageScript("document.querySelector('button').addEventListener('click', () => { while (true) {} });", { button: [button] });

  assert.throws(() => button.click(), isDeadline);
});

for (const name of ['fetch', 'require', 'process']) {
  test(`${name} is not a global inside the page — a ReferenceError, not a stand-in`, () => {
    assert.throws(() => runPageScript(`${name};`), isReferenceErrorFor(name));
  });
}

test('a button press posts through acquireVsCodeApi and lands in posted[]', () => {
  const smaller = new Node({ zoom: '-1' }, 'BUTTON');
  const larger = new Node({ zoom: '1' }, 'BUTTON');
  const page = runPageScript(`
    const vscode = acquireVsCodeApi();
    for (const button of document.querySelectorAll('button[data-zoom]')) {
      button.addEventListener('click', () => {
        vscode.postMessage({ type: 'zoom', delta: Number(button.dataset.zoom), field: '' });
      });
    }`, { 'button[data-zoom]': [smaller, larger] });

  larger.click();
  smaller.click();

  assert.deepEqual(page.posted, [
    { type: 'zoom', delta: 1, field: '' },
    { type: 'zoom', delta: -1, field: '' },
  ]);
  assert.deepEqual(smaller.listeners, ['click']);
});

test('a click runs the element\'s own listeners, then each ancestor\'s, then the document\'s — bubbling as a browser does — and closest() walks the same tree', () => {
  const list = new Node({}, 'UL');
  const item = new Node({ open: 'quick-start' }, 'LI').under(list);
  const label = new Node({}, 'SPAN').under(item);
  const page = runPageScript(`
    const vscode = acquireVsCodeApi();
    document.querySelector('li').addEventListener('click', () => { vscode.postMessage('own'); });
    document.querySelector('ul').addEventListener('click', (event) => {
      vscode.postMessage('list: ' + event.target.closest('li[data-open]').dataset.open + ' at ' + event.currentTarget.tagName);
    });
    document.addEventListener('click', (event) => {
      const hit = event.target.closest('[data-open]');
      vscode.postMessage(hit === null ? 'document: miss' : 'document: ' + hit.dataset.open);
    });`, { li: [item], ul: [list], span: [label] });

  item.click();
  label.click();

  assert.deepEqual(page.posted, [
    'own', 'list: quick-start at UL', 'document: quick-start',
    'own', 'list: quick-start at UL', 'document: quick-start',
  ]);
});

test('fire runs the listeners of THAT kind only, bubbles them the same way, and hands over the init the test gave', () => {
  const search = new Node({}, 'INPUT');
  const row = new Node({}, 'DIV');
  search.under(row);
  const page = runPageScript(`
    const vscode = acquireVsCodeApi();
    const search = document.getElementById('search');
    search.addEventListener('input', () => { vscode.postMessage('input: ' + search.value); });
    search.addEventListener('click', () => { vscode.postMessage('click'); });
    document.getElementById('row').addEventListener('input', (event) => { vscode.postMessage('row saw ' + event.target.value); });
    document.getElementById('language').addEventListener('change', (event) => { vscode.postMessage('change: ' + event.target.value); });
    document.addEventListener('input', () => { vscode.postMessage('document'); });`, {}, { search, row, language: new Node({}, 'SELECT') });

  search.value = 'abc';
  search.fire('input');
  const select = new Node({}, 'SELECT');
  assert.throws(() => select.fire('change'), /is not in the running page/);

  assert.deepEqual(page.posted, ['input: abc', 'row saw abc', 'document']);
});

test('a keydown dispatched by the test reaches the document\'s keydown listeners with its key, and only those', () => {
  const page = runPageScript(`
    const vscode = acquireVsCodeApi();
    document.addEventListener('keydown', (event) => { vscode.postMessage('key: ' + event.key); });
    document.addEventListener('click', () => { vscode.postMessage('click'); });`);

  page.keydown('Escape');
  page.keydown('a');

  assert.deepEqual(page.posted, ['key: Escape', 'key: a']);
});

test('window.scrollTo is recorded, as the one window call a page makes besides listening', () => {
  const page = runPageScript('window.scrollTo(0, 0); window.scrollTo(10, 240);');

  assert.deepEqual(page.scrolledTo, [[0, 0], [10, 240]]);
});

test('querySelectorAll on a node answers its matching descendants in document order — deep ones included — and nothing outside it', () => {
  const index = new Node({}, 'UL');
  const first = new Node({ open: 'alpha' }, 'LI').under(index);
  new Node({}, 'DIV').under(first);
  const nested = new Node({}, 'DIV').under(index);
  new Node({ open: 'beta' }, 'LI').under(nested);
  const other = new Node({ open: 'elsewhere' }, 'LI');
  const page = runPageScript(`
    const vscode = acquireVsCodeApi();
    const index = document.getElementById('index');
    vscode.postMessage([...index.querySelectorAll('li[data-open]')].map((li) => li.dataset.open));
    vscode.postMessage(index.querySelectorAll('[data-open="beta"]').length);
    vscode.postMessage(index.querySelectorAll('span[data-open]').length);
    vscode.postMessage(index.querySelector('[data-open]') === null ? 'none' : index.querySelector('[data-open]').dataset.open);
    vscode.postMessage(index.querySelector('[data-absent]'));`, { li: [other] }, { index });

  assert.deepEqual(page.posted, [['alpha', 'beta'], 1, 0, 'alpha', null]);
  assert.throws(() => index.querySelectorAll('.hidden'), /reads only \[data-x\] and \[data-x="y"\]/);
});

test('clicking a node the page was never handed fails instead of doing nothing', () => {
  runPageScript('');
  const stray = new Node({}, 'BUTTON');

  assert.throws(() => stray.click(), /is not in the running page/);
});

test('a message dispatched by the test reaches the page\'s window listener, and only the kind it asked for', () => {
  const offset = new Node({}, 'SPAN');
  const page = runPageScript(`
    window.addEventListener('message', (event) => {
      if (event.data?.type !== 'uiScale') { return; }
      document.body.style.fontSize = event.data.px + 'px';
      const node = document.getElementById('zoomOffset');
      if (node) { node.textContent = event.data.label; }
    });`, {}, { zoomOffset: offset });

  page.message({ type: 'textTone', color: '' });
  assert.equal(page.body.style.fontSize, '');
  assert.equal(offset.textContent, '');

  page.message({ type: 'uiScale', px: 15.73, label: '+2' });
  assert.equal(page.body.style.fontSize, '15.73px');
  assert.equal(offset.textContent, '+2');
});

test('a selector or id that matches nothing answers null and an empty list, never undefined', () => {
  const page = runPageScript(`
    acquireVsCodeApi().postMessage({
      one: document.querySelector('.absent') === null,
      byId: document.getElementById('absent') === null,
      all: document.querySelectorAll('.absent').length,
    });`);

  assert.deepEqual(page.posted, [{ one: true, byId: true, all: 0 }]);
});

test('what a page posts must be structured-cloneable, as it must be for a real postMessage', () => {
  assert.throws(
    () => runPageScript('acquireVsCodeApi().postMessage({ run: () => 1 });'),
    /could not be cloned/,
  );
});

test('classList keeps className in step: add, remove, toggle and contains', () => {
  const node = new Node();

  node.classList.add('a', 'b');
  assert.equal(node.className, 'a b');
  assert.ok(node.classList.contains('a'));

  node.classList.remove('a');
  assert.equal(node.className, 'b');
  assert.equal(node.classList.contains('a'), false);

  assert.equal(node.classList.toggle('hidden'), true);
  assert.equal(node.className, 'b hidden');
  assert.equal(node.classList.toggle('hidden'), false);
  assert.equal(node.className, 'b');
  assert.equal(node.classList.toggle('hidden', false), false);
  assert.equal(node.className, 'b');
  assert.equal(node.classList.toggle('hidden', true), true);
  assert.equal(node.className, 'b hidden');

  node.className = 'x  y';
  assert.ok(node.classList.contains('y'));
});

test('closest matches by presence or by exact value, by tag when the selector names one, includes the node itself, and refuses any other selector shape', () => {
  const anchor = new Node({ nav: 'home', removePrompt: 'p1' }, 'A');
  const leaf = new Node({}, 'SPAN').under(anchor);

  assert.equal(leaf.closest('[data-nav]'), anchor);
  assert.equal(leaf.closest('[data-nav="home"]'), anchor);
  assert.equal(leaf.closest('[data-remove-prompt="p1"]'), anchor);
  assert.equal(leaf.closest('[data-nav="away"]'), null);
  assert.equal(leaf.closest('[data-absent]'), null);
  assert.equal(anchor.closest('[data-nav]'), anchor);
  assert.equal(leaf.closest('a[data-nav]'), anchor);
  assert.equal(leaf.closest('a[data-nav="home"]'), anchor);
  assert.equal(leaf.closest('li[data-nav]'), null, 'a tag the selector names must match too — a browser would not answer the <a>');

  assert.throws(() => leaf.closest('.hidden'), /reads only \[data-x\] and \[data-x="y"\]/);
  assert.throws(() => leaf.closest('a'), /reads only \[data-x\] and \[data-x="y"\]/);
});

test('setAttribute, textContent, innerHTML, hidden and style are what the page wrote', () => {
  const node = new Node({}, 'DIV');
  runPageScript(`
    const el = document.getElementById('crumbs');
    el.setAttribute('aria-selected', 'true');
    el.textContent = 'Home';
    el.innerHTML = '<a data-nav="home">Home</a>';
    el.hidden = true;
    el.style.setProperty('--kit-text', 'red');
    el.style.color = 'var(--kit-text)';`, {}, { crumbs: node });

  assert.deepEqual(node.attributes, { 'aria-selected': 'true' });
  assert.equal(node.textContent, 'Home');
  assert.equal(node.innerHTML, '<a data-nav="home">Home</a>');
  assert.equal(node.hidden, true);
  assert.deepEqual(node.style.custom, { '--kit-text': 'red' });
  assert.equal(node.style.color, 'var(--kit-text)');
});

test('assertNoCr names the index of the first carriage return and accepts LF text', () => {
  assert.throws(() => assertNoCr('ab\r\ncd', 'the fragment'), /the fragment carries a carriage return at index 2/);
  assert.doesNotThrow(() => assertNoCr('ab\ncd\n', 'the fragment'));
});
