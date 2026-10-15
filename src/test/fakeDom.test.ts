import assert from 'node:assert/strict';
import { test } from 'node:test';

import { KIT_TAGS } from '../components/dom';
import { allowedAttribute, FakeDocument, parseSelector } from './fakeDom';

/**
 * The strict fake's own contract (`common.generated-code-tests` §3): a fake is code under test, and it may be stricter
 * than a browser but never more permissive. Each test names the browser behaviour it mirrors or the port rule it
 * enforces.
 */

test('createElement takes the port tags and refuses every other — script, img, a, iframe, style, link, form', () => {
  const doc = new FakeDocument();
  for (const tag of KIT_TAGS) {
    assert.equal(doc.node(doc.createElement(tag)).tagName, tag.toUpperCase());
  }
  for (const tag of ['script', 'img', 'a', 'iframe', 'style', 'link', 'form', 'select', 'DIV']) {
    assert.throws(() => doc.createElement(tag), /is not one of the port's tags/, tag);
  }
});

test('setAttribute takes the port attributes, aria-* and data-kit-*, and refuses style, on*, src, href and other data-*', () => {
  const doc = new FakeDocument();
  const view = doc.createElement('div');
  for (const name of ['role', 'id', 'type', 'tabindex', 'scope', 'colspan', 'aria-label', 'aria-sort', 'data-kit-row']) {
    view.setAttribute(name, 'x');
  }
  assert.equal(doc.node(view).attribute('aria-sort'), 'x');
  for (const name of ['style', 'onclick', 'src', 'href', 'data-row', 'aria-', 'data-kit-', 'class']) {
    assert.throws(() => { view.setAttribute(name, 'x'); }, /is not one of the port's attributes/, name);
  }
  assert.equal(allowedAttribute('aria-hidden'), true);
  assert.throws(() => { view.setAttribute('role', 1 as unknown as string); }, /takes a string/);
});

test('every member the port does not declare throws, naming it — the HTML sinks and style first of all', () => {
  const doc = new FakeDocument();
  const view = doc.createElement('div') as unknown as Record<string, unknown>;
  for (const member of ['innerHTML', 'outerHTML', 'insertAdjacentHTML', 'style', 'children', 'parentNode', 'remove', 'querySelector', 'dataset', 'classList']) {
    assert.throws(() => view[member], new RegExp(`reading DIV\\.${member} is not modelled`), member);
  }
  assert.throws(() => { view['innerHTML'] = '<b>x</b>'; }, /writing DIV\.innerHTML is not modelled/);
  assert.throws(() => { view['style'] = 'color: red'; }, /writing DIV\.style is not modelled/);
  assert.throws(() => { delete view['className']; }, /deleting DIV\.className/);
});

test('textContent takes a string only and, as in a browser, replaces the element\'s children', () => {
  const doc = new FakeDocument();
  const parent = doc.createElement('div');
  const child = doc.createElement('span');
  child.textContent = 'child';
  parent.appendChild(child);
  assert.equal(parent.textContent, 'child');
  parent.textContent = 'own';
  assert.equal(doc.node(parent).children.length, 0);
  assert.equal(doc.node(child).parent, undefined);
  assert.equal(parent.textContent, 'own');
  assert.throws(() => { parent.textContent = null; }, /takes a string, got object/);
});

test('hidden takes a boolean only', () => {
  const doc = new FakeDocument();
  const view = doc.createElement('div');
  view.hidden = true;
  assert.equal(doc.node(view).hidden, true);
  assert.throws(() => { view.hidden = 'until-found'; }, /hidden takes a boolean/);
});

test('appendChild of an attached child MOVES it, and a cycle is refused — as a browser does', () => {
  const doc = new FakeDocument();
  const a = doc.createElement('div');
  const b = doc.createElement('div');
  const child = doc.createElement('span');
  a.appendChild(child);
  b.appendChild(child);
  assert.equal(doc.node(a).children.length, 0);
  assert.deepEqual(doc.node(b).children, [doc.node(child)]);
  b.appendChild(child);
  assert.equal(doc.node(b).children.length, 1, 're-appending the last child keeps one copy');
  assert.throws(() => { child.appendChild(b); }, /inside itself/);
  assert.throws(() => { a.appendChild({} as never); }, /not an element of this document/);
});

test('focus() works on a connected, visible element and does nothing on a detached or hidden one — as a browser', () => {
  const doc = new FakeDocument();
  const root = doc.createElement('div');
  const button = doc.createElement('button');
  root.appendChild(button);
  button.focus();
  assert.equal(doc.activeElement, undefined, 'a detached element took the focus');
  doc.attach(root);
  root.hidden = true;
  button.focus();
  assert.equal(doc.activeElement, undefined, 'an element under a hidden ancestor took the focus');
  root.hidden = false;
  button.focus();
  assert.equal(doc.activeElement, doc.node(button));
});

test('an event bubbles from the element up to the body, in order, and reports a prevented default', () => {
  const doc = new FakeDocument();
  const outer = doc.createElement('div');
  const inner = doc.createElement('button');
  outer.appendChild(inner);
  doc.attach(outer);
  const heard: string[] = [];
  inner.addEventListener('keydown', (event) => { heard.push(`inner ${event.key ?? ''}`); });
  outer.addEventListener('keydown', (event) => { heard.push('outer'); event.preventDefault(); });
  outer.addEventListener('click', () => { heard.push('click'); });
  const event = doc.node(inner).dispatch('keydown', { key: 'Home' });
  assert.deepEqual(heard, ['inner Home', 'outer']);
  assert.equal(event.defaultPrevented, true);
  assert.equal(doc.node(inner).dispatch('keydown', { key: 'x' }).defaultPrevented, true);
});

test('an event cannot be dispatched at a detached or hidden element — nobody can reach one', () => {
  const doc = new FakeDocument();
  const root = doc.createElement('div');
  const button = doc.createElement('button');
  root.appendChild(button);
  assert.throws(() => doc.node(button).dispatch('click'), /not in the page/);
  doc.attach(root);
  root.hidden = true;
  assert.throws(() => doc.node(button).dispatch('click'), /hidden BUTTON/);
});

test('addEventListener takes the port events only, and a function', () => {
  const doc = new FakeDocument();
  const view = doc.createElement('div');
  for (const type of ['mouseover', 'change', 'focus', 'submit']) {
    assert.throws(() => { view.addEventListener(type as 'click', () => undefined); }, /not one of the port's events/, type);
  }
  assert.throws(() => { view.addEventListener('click', 'x' as never); }, /takes a function/);
});

test('value exists on an INPUT only, and takes a string', () => {
  const doc = new FakeDocument();
  const input = doc.createElement('input');
  input.value = 'abc';
  assert.equal(input.value, 'abc');
  assert.throws(() => { input.value = 3 as unknown as string; }, /takes a string/);
  const div = doc.createElement('div');
  assert.throws(() => div.value, /reading DIV\.value is not modelled/);
});

test('selectors are compounds of tag, .class, [a] and [a="v"] — a combinator or an id selector is refused, not answered', () => {
  assert.deepEqual(parseSelector('button.kit-tab[role="tab"][aria-selected]'), {
    tag: 'BUTTON', classes: ['kit-tab'], attributes: [{ name: 'role', value: 'tab' }, { name: 'aria-selected', value: undefined }],
  });
  for (const selector of ['div span', '#id', 'div > span', '[role=tab]', '.a,.b', ':focus']) {
    assert.throws(() => parseSelector(selector), /is not a compound/, selector);
  }
  const doc = new FakeDocument();
  const root = doc.createElement('div');
  const tab = doc.createElement('button');
  tab.className = 'kit-tab kit-tab--selected';
  tab.setAttribute('role', 'tab');
  root.appendChild(tab);
  const node = doc.node(root);
  assert.equal(node.all('.kit-tab--selected').length, 1);
  assert.equal(node.all('button[role="tab"]').length, 1);
  assert.equal(node.all('div[role="tab"]').length, 0);
  assert.equal(node.all('.kit-tab[role="tablist"]').length, 0);
});
