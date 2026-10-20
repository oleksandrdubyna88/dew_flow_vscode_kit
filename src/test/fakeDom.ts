import assert from 'node:assert/strict';

import { KIT_ATTRIBUTE_PREFIXES, KIT_ATTRIBUTES, KIT_EVENTS, KIT_TAGS, type KitDocument, type KitElement, type KitEvent } from '../components/dom';

/**
 * The STRICT fake document the webview components are run against (`research/PLAN_kit_components_storybook.md` §5.1).
 *
 * <p>A component never sees a {@link FakeNode}: it sees a PROXY per node that serves exactly the members the kit's
 * DOM port declares (`components/dom.ts`) and throws, naming the member, on anything else — `innerHTML`, `style`,
 * `outerHTML`, `insertAdjacentHTML`, `children`, `parentNode`… A component that reached past its port fails here by
 * name even where a browser would have obliged. `createElement` takes only the port's tags, `setAttribute` only its
 * attributes and prefixes, `addEventListener` only its events; `textContent` and an attribute value take only
 * strings, `hidden` only a boolean, and an input's `value` exists on an INPUT alone.</p>
 *
 * <p>Where the fake models a behaviour it models the browser's, never a kinder one (`common.generated-code-tests`
 * §3): `textContent` replaces an element's children; `appendChild` of an attached child MOVES it and refuses a
 * cycle; `focus()` on a node that is not connected to the body, or sits under a hidden ancestor, does nothing; a
 * click or a key can only be dispatched at a connected, visible node, and bubbles up to the body. Its own contract
 * tests are `src/test/fakeDom.test.ts`; every behaviour test also runs against jsdom (`src/test/domDrivers.ts`).</p>
 */

/** What the components hold: an element of the fake, as the port types it. */
export interface FakeView extends KitElement<FakeView> {
  /** Present on an INPUT only; reading or writing it elsewhere throws. */
  value: string;
}

type Listener = (event: KitEvent) => void;

/** One dispatched event as a listener sees it, plus what the test reads back. */
export interface FakeEvent extends KitEvent {
  readonly type: string;
  readonly defaultPrevented: boolean;
}

/** A selector of the compound shapes the tests use: an optional tag, classes, `[a]` and `[a="v"]` — no combinators. */
interface Compound {
  readonly tag: string | undefined;
  readonly classes: readonly string[];
  readonly attributes: readonly { readonly name: string; readonly value: string | undefined }[];
}

const SELECTOR_PART = /^(?:([a-z][a-z0-9]*)|\.([a-z][a-z0-9_-]*)|\[([a-z][a-z0-9-]*)(?:="([^"]*)")?\])/;

/** A compound selector parsed, or the test fails naming the shape the fake does not read. */
export function parseSelector(selector: string): Compound {
  let rest = selector;
  let tag: string | undefined;
  const classes: string[] = [];
  const attributes: { name: string; value: string | undefined }[] = [];
  while (rest.length > 0) {
    const part = SELECTOR_PART.exec(rest);
    assert.ok(part !== null, `fake DOM: the selector ${JSON.stringify(selector)} is not a compound of tag, .class, [a] and [a="v"]`);
    if (part[1] !== undefined) {
      assert.ok(tag === undefined && rest === selector, `fake DOM: the tag must come first in ${JSON.stringify(selector)}`);
      tag = part[1].toUpperCase();
    } else if (part[2] !== undefined) {
      classes.push(part[2]);
    } else {
      attributes.push({ name: part[3] ?? '', value: part[4] });
    }
    rest = rest.slice(part[0].length);
  }

  return { tag, classes, attributes };
}

/** A node of the fake, as the TEST sees it: everything readable, nothing guarded. */
export class FakeNode {
  readonly children: FakeNode[] = [];
  parent: FakeNode | undefined = undefined;
  /** This node's own text; {@link textContent} adds its descendants'. */
  text = '';
  className = '';
  hidden = false;
  value = '';
  readonly attributes = new Map<string, string>();
  readonly listeners: { readonly type: string; readonly run: Listener }[] = [];

  constructor(readonly tagName: string, readonly document: FakeDocument) {}

  get textContent(): string {
    return this.text + this.children.map((child) => child.textContent).join('');
  }

  get classes(): string[] {
    return this.className.split(/\s+/).filter((name) => name.length > 0);
  }

  attribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }

  /** Every node under this one, depth first, in document order. */
  descendants(): FakeNode[] {
    return this.children.flatMap((child) => [child, ...child.descendants()]);
  }

  matches(selector: string): boolean {
    const wanted = parseSelector(selector);

    return (wanted.tag === undefined || wanted.tag === this.tagName)
      && wanted.classes.every((name) => this.classes.includes(name))
      && wanted.attributes.every(({ name, value }) => this.attributes.has(name) && (value === undefined || this.attributes.get(name) === value));
  }

  all(selector: string): FakeNode[] {
    parseSelector(selector);

    return this.descendants().filter((node) => node.matches(selector));
  }

  /** Exactly one node under this one matching `selector`, or the test fails naming how many there were. */
  one(selector: string): FakeNode {
    const found = this.all(selector);
    assert.equal(found.length, 1, `expected one ${selector}, found ${found.length}`);

    return found[0] as FakeNode;
  }

  /** Whether the node hangs under the document's body. */
  get connected(): boolean {
    const chain = ancestry(this);

    return chain[chain.length - 1] === this.document.body;
  }

  /** Whether this node or an ancestor is `hidden` — as a browser, the fake will not focus or click such a node. */
  get concealed(): boolean {
    return ancestry(this).some((at) => at.hidden);
  }

  /** Dispatches an event at this node: its listeners of that type, then each ancestor's. */
  dispatch(type: string, init: { readonly key?: string } = {}): FakeEvent {
    assert.ok(this.connected, `fake DOM: a ${type} was dispatched at a ${this.tagName} that is not in the page`);
    assert.ok(!this.concealed, `fake DOM: a ${type} was dispatched at a hidden ${this.tagName} — nobody can reach it`);
    let prevented = false;
    const event: FakeEvent = {
      type,
      ...(init.key === undefined ? {} : { key: init.key }),
      preventDefault: (): void => { prevented = true; },
      get defaultPrevented(): boolean { return prevented; },
    };
    for (const at of ancestry(this)) {
      at.listeners.filter((listener) => listener.type === type).forEach((listener) => { listener.run(event); });
    }

    return event;
  }
}

/** `node`, its parent, its parent's parent… up to the top. */
function ancestry(node: FakeNode): FakeNode[] {
  const chain: FakeNode[] = [];
  for (let at: FakeNode | undefined = node; at !== undefined; at = at.parent) {
    chain.push(at);
  }

  return chain;
}

function stringOnly(value: unknown, what: string): string {
  assert.ok(typeof value === 'string', `fake DOM: ${what} takes a string, got ${typeof value}`);

  return value;
}

/** Whether `name` is an attribute the port allows. */
export function allowedAttribute(name: string): boolean {
  return (KIT_ATTRIBUTES as readonly string[]).includes(name) || KIT_ATTRIBUTE_PREFIXES.some((prefix) => name.startsWith(prefix) && name.length > prefix.length);
}

interface Member {
  readonly get?: () => unknown;
  readonly set?: (value: unknown) => void;
}

/** The strict document: what a component may call, and the test's way back from a view to its node. */
export class FakeDocument implements KitDocument<FakeView> {
  readonly body: FakeNode;
  activeElement: FakeNode | undefined = undefined;
  private readonly toView = new Map<FakeNode, FakeView>();
  private readonly toNode = new WeakMap<object, FakeNode>();

  constructor() {
    this.body = new FakeNode('BODY', this);
  }

  createElement(tag: unknown): FakeView {
    const name = stringOnly(tag, 'createElement');
    assert.ok((KIT_TAGS as readonly string[]).includes(name), `fake DOM: createElement(${JSON.stringify(name)}) is not one of the port's tags`);

    return this.view(new FakeNode(name.toUpperCase(), this));
  }

  /** The node behind a view this document made — the test's way in. */
  node(view: unknown): FakeNode {
    const found = typeof view === 'object' && view !== null ? this.toNode.get(view) : undefined;
    assert.ok(found !== undefined, 'fake DOM: not an element of this document');

    return found;
  }

  /** The view of a node, made once. */
  view(node: FakeNode): FakeView {
    const known = this.toView.get(node);
    if (known !== undefined) {
      return known;
    }
    const proxy = new Proxy({}, this.traps(node)) as FakeView;
    this.toView.set(node, proxy);
    this.toNode.set(proxy, node);

    return proxy;
  }

  /** Places a component's root under the body, as a page would. */
  attach(view: FakeView): FakeNode {
    const node = this.node(view);
    adopt(this.body, node);

    return node;
  }

  private traps(node: FakeNode): ProxyHandler<object> {
    const members = this.members(node);
    const refuse = (key: string | symbol, how: string): never => {
      throw new Error(`strict DOM: ${how} ${node.tagName}.${String(key)} is not modelled`);
    };

    return {
      get: (_target, key) => (typeof key === 'string' && members[key]?.get !== undefined ? members[key].get() : refuse(key, 'reading')),
      set: (_target, key, value) => {
        const member = typeof key === 'string' ? members[key] : undefined;
        if (member?.set === undefined) {
          return refuse(key, 'writing');
        }
        member.set(value);

        return true;
      },
      has: (_target, key) => typeof key === 'string' && key in members,
      deleteProperty: (_target, key) => refuse(key, 'deleting'),
      defineProperty: (_target, key) => refuse(key, 'defining'),
    };
  }

  private members(node: FakeNode): Readonly<Record<string, Member>> {
    const fn = (run: (...args: unknown[]) => unknown): Member => ({ get: () => run });
    const input: Record<string, Member> = node.tagName === 'INPUT'
      ? { value: { get: () => node.value, set: (value) => { node.value = stringOnly(value, 'value'); } } }
      : {};

    return {
      tagName: { get: () => node.tagName },
      textContent: {
        get: () => node.textContent,
        set: (value) => {
          node.text = stringOnly(value, 'textContent');
          for (const child of node.children.splice(0)) {
            child.parent = undefined;
          }
        },
      },
      className: { get: () => node.className, set: (value) => { node.className = stringOnly(value, 'className'); } },
      hidden: {
        get: () => node.hidden,
        set: (value) => {
          assert.ok(typeof value === 'boolean', `fake DOM: hidden takes a boolean, got ${typeof value}`);
          node.hidden = value;
        },
      },
      setAttribute: fn((name, value) => {
        const key = stringOnly(name, 'setAttribute(name)');
        assert.ok(allowedAttribute(key), `fake DOM: setAttribute(${JSON.stringify(key)}) is not one of the port's attributes — never style, on*, src or href`);
        node.attributes.set(key, stringOnly(value, `setAttribute(${key})`));
      }),
      appendChild: fn((child) => { adopt(node, this.node(child)); return child; }),
      addEventListener: fn((type, run) => {
        const name = stringOnly(type, 'addEventListener(type)');
        assert.ok((KIT_EVENTS as readonly string[]).includes(name), `fake DOM: listening for ${name} is not one of the port's events`);
        assert.ok(typeof run === 'function', 'fake DOM: addEventListener takes a function');
        node.listeners.push({ type: name, run: run as Listener });
      }),
      focus: fn(() => {
        if (node.connected && !node.concealed) {
          this.activeElement = node;
        }
      }),
      ...input,
    };
  }
}

/** Places `child` under `parent`, moving it if it was attached elsewhere; a cycle is refused, as a browser refuses it. */
function adopt(parent: FakeNode, child: FakeNode): void {
  assert.ok(child !== parent && !child.descendants().includes(parent), 'fake DOM: appendChild would place an element inside itself');
  if (child.parent !== undefined) {
    child.parent.children.splice(child.parent.children.indexOf(child), 1);
  }
  child.parent = parent;
  parent.children.push(child);
}
