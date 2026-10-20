#!/usr/bin/env node
/**
 * Runs the fixture's WEBVIEW bundle the way a webview would — with a `document` and nothing of node — and asserts
 * the components it bundled from the installed package work:
 *
 *     node run-webview.mjs dist/webview.js dist/webview.css
 *
 * The bundle (esbuild, `platform: 'browser'`, `format: 'iife'`) runs in a `node:vm` context whose only global beyond
 * the language's own is `document`: no `require`, no `process`, no `module` — a bundle that still needed one fails
 * here. The document is a small DOM covering exactly the kit's port (`src/components/dom.ts`: createElement, and on
 * an element className, textContent, hidden, setAttribute, appendChild that moves, addEventListener, focus, value);
 * anything else a component reached for would be `undefined` and fail loudly. The stylesheet esbuild emitted beside
 * the bundle must carry the kit's token block. Node built-ins only; exit 0 and one line on success.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const DEADLINE_MS = 5_000;

class Element {
  constructor(tagName) {
    this.tagName = tagName.toUpperCase();
    this.className = '';
    this.hidden = false;
    this.value = '';
    this.own = '';
    this.parent = undefined;
    this.children = [];
    this.attributes = new Map();
    this.listeners = [];
  }

  get textContent() {
    return this.own + this.children.map((child) => child.textContent).join('');
  }

  set textContent(text) {
    this.own = String(text);
    for (const child of this.children.splice(0)) {
      child.parent = undefined;
    }
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  appendChild(child) {
    if (child.parent !== undefined) {
      child.parent.children.splice(child.parent.children.indexOf(child), 1);
    }
    child.parent = this;
    this.children.push(child);
    return child;
  }

  addEventListener(type, listener) {
    this.listeners.push({ type, listener });
  }

  focus() {}

  /** Every element under this one, depth first. */
  all() {
    return this.children.flatMap((child) => [child, ...child.all()]);
  }

}

/** A click on `element`: its listeners, then each ancestor's. */
function click(element) {
  for (let at = element; at !== undefined; at = at.parent) {
    at.listeners.filter((entry) => entry.type === 'click').forEach((entry) => entry.listener({ preventDefault() {} }));
  }
}

const [bundlePath, cssPath] = process.argv.slice(2);
assert.ok(bundlePath !== undefined && cssPath !== undefined, 'usage: node run-webview.mjs <bundle.js> <bundle.css>');

const css = readFileSync(cssPath, 'utf8');
assert.match(css, /--kit-fg:\s*var\(--vscode-foreground/, 'the emitted stylesheet does not carry the kit\'s token block');
assert.match(css, /\.kit-table__sort/, 'the emitted stylesheet does not carry the DataTable rules');

const body = new Element('body');
const context = vm.createContext({ document: { body, createElement: (tag) => new Element(tag) } });
vm.runInContext(readFileSync(bundlePath, 'utf8'), context, { timeout: DEADLINE_MS, filename: bundlePath });

const fixture = context.kitFixture;
assert.ok(fixture !== undefined, 'the bundle did not run to its end');
const everything = body.all();
assert.equal(everything.filter((node) => node.attributes.get('role') === 'tab').length, 2, 'the tabs were not rendered');
const rows = () => everything.filter((node) => node.className === 'kit-table__row' && !node.hidden);
assert.deepEqual(rows().map((row) => row.children[0].textContent), ['beta', 'alpha', 'gamma']);

fixture.table.sortBy('size', 'descending');
// Copied into this realm: the bundle's arrays carry the vm context's own Array.prototype.
assert.deepEqual([...fixture.table.order()], [0, 2, 1], 'sorted by size, descending, absent last');
const firstShown = body.all().filter((node) => node.className === 'kit-table__row' && !node.hidden)[0];
click(firstShown.all().find((node) => node.attributes.has('data-kit-reveal')));
assert.deepEqual([...fixture.revealed], [0], 'the reveal told the row index in the given rows');
assert.equal(body.textContent.includes('units'), true, 'the consumer\'s format did not shape a cell');

console.log(`consumer-fixture webview: ok — the bundle ran with only a document; ${everything.length} elements, a sort, a reveal, ${css.length} bytes of CSS`);
