import assert from 'node:assert/strict';

import { JSDOM } from 'jsdom';

import type { KitDocument, KitElement } from '../components/dom';
import { FakeDocument, parseSelector, type FakeNode, type FakeView } from './fakeDom';

/** A jsdom element: the kit's port, plus what the tests read and dispatch with. */
export interface JsdomElement extends KitElement<JsdomElement> {
  value: string;
  /** Test code only — how the axe test places an existing renderer's markup; the components never use it. */
  innerHTML: string;
  getAttribute(name: string): string | null;
  querySelectorAll(selector: string): ArrayLike<JsdomElement>;
  closest(selector: string): JsdomElement | null;
  dispatchEvent(event: object): boolean;
  click(): void;
}

export interface JsdomDocument extends KitDocument<JsdomElement> {
  readonly body: JsdomElement;
  readonly head: JsdomElement;
  readonly activeElement: JsdomElement | null;
  createElement(tag: string): JsdomElement;
}

/** A jsdom window, as far as the tests use it. */
export interface JsdomWindow {
  readonly document: JsdomDocument;
  readonly KeyboardEvent: new (type: string, init: { key: string; bubbles: boolean; cancelable: boolean }) => object;
  readonly Event: new (type: string, init: { bubbles: boolean; cancelable?: boolean }) => object;
  /** Runs a script in the window — how axe-core's own bundled source is loaded into it (`axe.test.ts`). */
  eval(source: string): unknown;
  close(): void;
}

/**
 * One behaviour suite, two documents (`research/PLAN_kit_components_storybook.md` §5.1): every component test runs on the
 * STRICT fake (`fakeDom.ts` — refuses whatever the kit's DOM port does not declare) and on jsdom (a real DOM
 * implementation — catches a behaviour only the fake allows). A test reads the page through {@link DomNode} and acts
 * through the driver, so it is written once and cannot know which document it runs on. Selectors are the fake's
 * compound subset on BOTH, so a test cannot pass on jsdom with a selector the fake would refuse.
 */

/** A rendered node, as a test reads it. */
export interface DomNode {
  readonly tag: string;
  readonly text: string;
  readonly classes: readonly string[];
  /** This node's own `hidden`. */
  readonly hidden: boolean;
  /** This node or an ancestor is hidden — a person cannot see or reach it. */
  readonly concealed: boolean;
  attribute(name: string): string | null;
  all(selector: string): DomNode[];
  one(selector: string): DomNode;
  /** Whether two handles are the same element. */
  is(other: DomNode): boolean;
}

/** What a person does, and what the test reads back. */
export interface Driver<E extends KitElement<E>> {
  readonly name: string;
  readonly doc: KitDocument<E>;
  /** Places a component's root in the page and answers it as a node. */
  attach(view: E): DomNode;
  /** A node for an element the test holds. */
  node(view: E): DomNode;
  click(node: DomNode): void;
  /** A key pressed on `node`; answers whether a listener prevented its default. */
  key(node: DomNode, key: string): boolean;
  /** Types `value` into an input, as a person would: the value changes, then `input` fires. */
  type(node: DomNode, value: string): void;
  /** The focused element, or `undefined` when the body has the focus. */
  focused(): DomNode | undefined;
  /** An element the consumer would have built itself — the test's stand-in for a consumer's own button or panel. */
  make(tag: 'button' | 'div' | 'p', text: string): E;
}

function exactlyOne(found: readonly DomNode[], selector: string): DomNode {
  assert.equal(found.length, 1, `expected one ${selector}, found ${found.length}`);

  return found[0] as DomNode;
}

class FakeHandle implements DomNode {
  constructor(readonly raw: FakeNode) {}

  get tag(): string { return this.raw.tagName; }
  get text(): string { return this.raw.textContent; }
  get classes(): readonly string[] { return this.raw.classes; }
  get hidden(): boolean { return this.raw.hidden; }
  get concealed(): boolean { return this.raw.concealed; }
  attribute(name: string): string | null { return this.raw.attribute(name); }
  all(selector: string): DomNode[] { return this.raw.all(selector).map((node) => new FakeHandle(node)); }
  one(selector: string): DomNode { return exactlyOne(this.all(selector), selector); }
  is(other: DomNode): boolean { return other instanceof FakeHandle && other.raw === this.raw; }
}

/** The strict fake, behind the driver. */
export function fakeDriver(): Driver<FakeView> {
  const doc = new FakeDocument();
  const raw = (node: DomNode): FakeNode => {
    assert.ok(node instanceof FakeHandle, 'a node of another document');
    return node.raw;
  };

  return {
    name: 'strict fake',
    doc,
    attach: (view) => new FakeHandle(doc.attach(view)),
    node: (view) => new FakeHandle(doc.node(view)),
    click: (node) => { raw(node).dispatch('click'); },
    key: (node, key) => raw(node).dispatch('keydown', { key }).defaultPrevented,
    type: (node, value) => {
      const target = raw(node);
      assert.equal(target.tagName, 'INPUT', 'typing into something that is not an input');
      target.value = value;
      target.dispatch('input');
    },
    focused: () => (doc.activeElement === undefined ? undefined : new FakeHandle(doc.activeElement)),
    make: (tag, text) => {
      const made = doc.createElement(tag);
      made.textContent = text;
      return made;
    },
  };
}

class JsdomHandle implements DomNode {
  constructor(readonly raw: JsdomElement) {}

  get tag(): string { return this.raw.tagName; }
  get text(): string { return this.raw.textContent ?? ''; }
  get classes(): readonly string[] { return this.raw.className.split(/\s+/).filter((name) => name.length > 0); }
  get hidden(): boolean { return this.raw.hidden === true; }
  get concealed(): boolean { return this.raw.closest('[hidden]') !== null; }
  attribute(name: string): string | null { return this.raw.getAttribute(name); }

  all(selector: string): DomNode[] {
    parseSelector(selector);

    return Array.from(this.raw.querySelectorAll(selector), (element) => new JsdomHandle(element));
  }

  one(selector: string): DomNode { return exactlyOne(this.all(selector), selector); }
  is(other: DomNode): boolean { return other instanceof JsdomHandle && other.raw === this.raw; }
}

/** A fresh jsdom window: by default an empty page; its own scripts never run (`outside-only`). */
export function jsdomWindow(html = '<!DOCTYPE html><html lang="en"><head><title>kit</title></head><body></body></html>'): JsdomWindow {
  const dom = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true });

  // The one cast at jsdom's untyped boundary: the members `JsdomWindow` names are jsdom's own, used as named.
  return dom.window as JsdomWindow;
}

/** jsdom, behind the driver. */
export function jsdomDriver(window: JsdomWindow = jsdomWindow()): Driver<JsdomElement> {
  const doc: JsdomDocument = window.document;
  const raw = (node: DomNode): JsdomElement => {
    assert.ok(node instanceof JsdomHandle, 'a node of another document');
    assert.ok(!node.concealed, `a ${node.tag} under a hidden ancestor cannot be reached`);
    return node.raw;
  };

  return {
    name: 'jsdom',
    doc,
    attach: (view) => { doc.body.appendChild(view); return new JsdomHandle(view); },
    node: (view) => new JsdomHandle(view),
    click: (node) => { raw(node).click(); },
    key: (node, key) => !raw(node).dispatchEvent(new window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })),
    type: (node, value) => {
      const target = raw(node);
      target.value = value;
      target.dispatchEvent(new window.Event('input', { bubbles: true }));
    },
    focused: () => {
      const active = doc.activeElement;
      return active === null || active === doc.body ? undefined : new JsdomHandle(active);
    },
    make: (tag, text) => {
      const made = doc.createElement(tag);
      made.textContent = text;
      return made;
    },
  };
}

/** A behaviour suite, written once over whichever document it is handed; `make` gives each test a fresh page. */
export type Suite = <E extends KitElement<E>>(make: () => Driver<E>, name: string) => void;

/** Runs `suite` on the strict fake, then on jsdom. */
export function onEveryDocument(suite: Suite): void {
  suite(fakeDriver, 'strict fake');
  suite(() => jsdomDriver(), 'jsdom');
}
