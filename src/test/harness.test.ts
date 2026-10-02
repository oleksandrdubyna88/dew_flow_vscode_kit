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

test('a click runs the element\'s own listeners first and then the document\'s, walking closest() up the tree', () => {
  const item = new Node({ open: 'quick-start' }, 'LI');
  const label = new Node({}, 'SPAN').under(item);
  const page = runPageScript(`
    const vscode = acquireVsCodeApi();
    document.querySelector('li').addEventListener('click', () => { vscode.postMessage('own'); });
    document.addEventListener('click', (event) => {
      const hit = event.target.closest('[data-open]');
      vscode.postMessage(hit === null ? 'document: miss' : 'document: ' + hit.dataset.open);
    });`, { li: [item], span: [label] });

  item.click();
  label.click();

  assert.deepEqual(page.posted, ['own', 'document: quick-start', 'document: quick-start']);
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

test('closest matches by presence or by exact value, includes the node itself, and refuses any other selector shape', () => {
  const anchor = new Node({ nav: 'home', removePrompt: 'p1' }, 'A');
  const leaf = new Node({}, 'SPAN').under(anchor);

  assert.equal(leaf.closest('[data-nav]'), anchor);
  assert.equal(leaf.closest('[data-nav="home"]'), anchor);
  assert.equal(leaf.closest('[data-remove-prompt="p1"]'), anchor);
  assert.equal(leaf.closest('[data-nav="away"]'), null);
  assert.equal(leaf.closest('[data-absent]'), null);
  assert.equal(anchor.closest('[data-nav]'), anchor);

  assert.throws(() => leaf.closest('a[data-nav]'), /reads only \[data-x\] and \[data-x="y"\]/);
  assert.throws(() => leaf.closest('.hidden'), /reads only \[data-x\] and \[data-x="y"\]/);
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
