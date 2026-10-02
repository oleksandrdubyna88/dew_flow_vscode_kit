import assert from 'node:assert/strict';
import { createContext, runInContext, Script, type Context } from 'node:vm';

/**
 * The harness that RUNS a page script — the kit's one DOM shim, shared by every test that drives one.
 *
 * <p><b>Why it exists.</b> A page is assembled as a template literal and handed to VS Code as text, so
 * a substring assertion over that text cannot see a control wired to the wrong branch: the string
 * contains everything it was supposed to contain. `.agents/PROJECT.md` makes that an operator ruling,
 * and the plan's gate accepted the shape: the harness provides the DOM and the host-event stubs, and a
 * page script is tested by running it.</p>
 *
 * <p><b>Ported from</b> ConnectOtherAIs' `src_vs_code/src/test/rolesPageHarness.ts` (the nodes a test
 * hands in by selector, a click that runs the element's own listeners and then the document's, the
 * `posted[]` a test reads back) with the sandbox of the family's other shim, `miniDom.ts`: `node:vm`
 * rather than `new Function`, so the page sees an EXPLICIT allowlist of globals — `document`, `window`,
 * `acquireVsCodeApi` — and nothing of this process. No `require`, no `process`, no `fetch`; a script
 * that reaches for one meets a `ReferenceError`, which is also what a webview would answer.</p>
 *
 * <p><b>Deadline.</b> The script runs under `timeout: 5000`, and so does every event the test dispatches
 * into it afterwards — a click, a message — because a defective generator's `while (true) {}` is as
 * likely to live in a handler as at the top level, and an unbounded run does not fail, it hangs the
 * suite. A handler is reached through a trampoline run in the same context with the same deadline.</p>
 *
 * <p><b>Stricter than a browser, never more permissive.</b> `querySelector` and `getElementById` answer
 * `null` for a miss, never `undefined` — every `!== null` guard in a page depends on it. A node the page
 * was never handed cannot be clicked. `closest` understands the two selector shapes the pages use and
 * REFUSES any other, rather than answering `null` and letting a guard pass. What a page posts must be
 * structured-cloneable, as it must be for a real `postMessage`; the copy also brings each message into
 * this realm, so `assert.deepEqual` compares values rather than two realms' `Object.prototype`.</p>
 */

const TIMEOUT_MS = 5000;

type Handler = (event: unknown) => void;

interface Listener {
  readonly kind: string;
  readonly run: Handler;
}

/** What `runPageScript` hands every node it is given: the deadline, and the document's click listeners. */
interface Wiring {
  bounded(run: () => void): void;
  documentClick(node: Node): void;
}

/**
 * An element's `style`, recording what a page writes: the two properties the text controls set by name,
 * and every custom property through `setProperty` — the tone is two of those.
 */
export class Style {
  fontSize = '';
  color = '';
  readonly custom: Record<string, string> = {};

  setProperty(name: string, value: string): void {
    this.custom[name] = value;
  }
}

/** `classList`, backed by the element's `className` so the two stay in step as a browser keeps them. */
export class ClassList {
  constructor(private readonly owner: Node) {}

  add(...names: string[]): void {
    this.write([...new Set([...this.names(), ...names])]);
  }

  remove(...names: string[]): void {
    const gone = new Set(names);
    this.write(this.names().filter((name) => !gone.has(name)));
  }

  contains(name: string): boolean {
    return this.names().includes(name);
  }

  /** As the DOM's: `force` decides, otherwise the class flips; the answer is whether it is now present. */
  toggle(name: string, force?: boolean): boolean {
    const on = force ?? !this.contains(name);
    if (on) {
      this.add(name);
    } else {
      this.remove(name);
    }

    return on;
  }

  private names(): string[] {
    return this.owner.className.split(/\s+/).filter((name) => name.length > 0);
  }

  private write(names: readonly string[]): void {
    this.owner.className = names.join(' ');
  }
}

/** Just enough of an element for the pages' own `closest`, `dataset`, class, text and style writes. */
export class Node {
  readonly dataset: Record<string, string>;
  readonly tagName: string;
  className = '';
  readonly classList: ClassList = new ClassList(this);
  /** What `setAttribute` has written — a page keeps `aria-*` in step with its classes. */
  readonly attributes: Record<string, string> = {};
  textContent = '';
  innerHTML = '';
  hidden = false;
  readonly style = new Style();
  parent: Node | undefined = undefined;
  /** The kinds of the listeners a page bound here, in order — what a test asserts a control was wired with. */
  readonly listeners: string[] = [];
  private readonly handlers: Listener[] = [];
  private wiring: Wiring | undefined = undefined;

  constructor(dataset: Record<string, string> = {}, tagName = 'DIV') {
    this.dataset = dataset;
    this.tagName = tagName;
  }

  addEventListener(kind: string, run: Handler): void {
    this.listeners.push(kind);
    this.handlers.push({ kind, run });
  }

  /**
   * A click: this element's own click listeners first, then the document's, as a browser bubbles it —
   * under the page's deadline. A node the running page was never handed has nowhere to bubble to, and
   * says so rather than doing nothing.
   */
  click(): void {
    const wiring = this.wiring;
    assert.ok(wiring !== undefined, `this ${this.tagName} was clicked but is not in the running page`);
    wiring.bounded(() => {
      const event = { target: this, currentTarget: this, preventDefault: (): void => undefined };
      for (const handler of this.handlers) {
        if (handler.kind === 'click') {
          handler.run(event);
        }
      }
      wiring.documentClick(this);
    });
  }

  /**
   * The chain upwards from this node, matching `[data-x]` and `[data-x="y"]` — the two shapes the pages
   * use. Any other selector is refused: a `null` for a shape this shim cannot read would let a page's
   * guard pass against an element it never found.
   */
  closest(selector: string): Node | null {
    const exact = /^\[data-([a-z][a-z0-9-]*)="([^"]*)"\]$/.exec(selector);
    const any = /^\[data-([a-z][a-z0-9-]*)\]$/.exec(selector);
    const found = exact ?? any;
    assert.ok(found !== null, `closest(${JSON.stringify(selector)}): this harness reads only [data-x] and [data-x="y"]`);
    const key = camel(found[1] ?? '');
    // Walking up a DOM chain from this node IS the operation: the loop variable starts at `this`.
    // eslint-disable-next-line @typescript-eslint/no-this-alias -- deliberate, see above
    for (let at: Node | undefined = this; at !== undefined; at = at.parent) {
      const held = at.dataset[key];
      if (held !== undefined && (exact === null || held === exact[2])) {
        return at;
      }
    }

    return null;
  }

  setAttribute(name: string, value: string): void {
    this.attributes[name] = value;
  }

  /** Places this node under `parent` and returns it, so a tree reads as one expression in a test. */
  under(parent: Node): Node {
    this.parent = parent;

    return this;
  }

  /** Called by {@link runPageScript} for every node it is handed. A node belongs to one page. */
  wire(wiring: Wiring): void {
    assert.ok(this.wiring === undefined, `this ${this.tagName} was handed to two pages`);
    this.wiring = wiring;
  }
}

/** `data-remove-prompt` reaches a script as `dataset.removePrompt`, as a browser spells it. */
export function camel(attribute: string): string {
  return attribute.replace(/-([a-z])/g, (_all, letter: string) => letter.toUpperCase());
}

/** What the running page offers a test: what it posted, the host's voice, and the two styled roots. */
export interface Page {
  /** Every message the page posted, each copied into this realm. */
  readonly posted: readonly unknown[];
  /** A message from the host, delivered to every `window` message listener as `{ data }`. */
  message(data: unknown): void;
  /** `document.body` — where the text size and tone are written. */
  readonly body: Node;
  /** `document.documentElement` — the root, which `rem` is measured from. */
  readonly root: Node;
}

/**
 * Not an identifier, so no page script can reach it by name: the one door a dispatched event enters by.
 * The trampoline runs INSIDE the context, which is what puts the deadline on a handler.
 */
const SLOT = '\u0000dispatch';
const TRAMPOLINE = new Script(`globalThis[${JSON.stringify(SLOT)}]()`);

function runBounded(context: Context, sandbox: Record<string, unknown>, run: () => void): void {
  Object.defineProperty(sandbox, SLOT, { value: run, configurable: true, enumerable: false, writable: false });
  try {
    TRAMPOLINE.runInContext(context, { timeout: TIMEOUT_MS });
  } finally {
    delete sandbox[SLOT];
  }
}

/**
 * Run a page's script and collect everything it posts.
 *
 * <p>`nodes` are what `document.querySelectorAll` / `querySelector` answer with, keyed by the selector the
 * page asks for; `ids` are what `document.getElementById` answers with. A test that presses a button
 * needs the page to FIND it, and a shim that answered every selector with a stand-in would let a broken
 * wiring look exactly like a working one — so a selector or id the test did not hand in answers with
 * nothing, as a browser answers for an element that is not on the page.</p>
 */
export function runPageScript(
  script: string,
  nodes: Readonly<Record<string, readonly Node[]>> = {},
  ids: Readonly<Record<string, Node>> = {},
): Page {
  const posted: unknown[] = [];
  const documentListeners: Listener[] = [];
  const windowListeners: Listener[] = [];
  const root = new Node({}, 'HTML');
  const body = new Node({}, 'BODY').under(root);

  const sandbox: Record<string, unknown> = {
    document: {
      getElementById: (id: string): Node | null => ids[id] ?? null,
      querySelector: (selector: string): Node | null => nodes[selector]?.[0] ?? null,
      querySelectorAll: (selector: string): readonly Node[] => nodes[selector] ?? [],
      addEventListener: (kind: string, run: Handler): void => { documentListeners.push({ kind, run }); },
      body,
      documentElement: root,
    },
    window: {
      addEventListener: (kind: string, run: Handler): void => { windowListeners.push({ kind, run }); },
    },
    acquireVsCodeApi: () => ({
      postMessage: (message: unknown): void => { posted.push(structuredClone(message)); },
    }),
  };
  const context = createContext(sandbox);
  const wiring: Wiring = {
    bounded: (run) => { runBounded(context, sandbox, run); },
    documentClick: (node) => {
      const event = { target: node, preventDefault: (): void => undefined };
      for (const listener of documentListeners) {
        if (listener.kind === 'click') {
          listener.run(event);
        }
      }
    },
  };
  for (const node of [root, body, ...Object.values(ids), ...Object.values(nodes).flat()]) {
    node.wire(wiring);
  }

  runInContext(script, context, { timeout: TIMEOUT_MS });

  return {
    posted,
    message: (data) => {
      wiring.bounded(() => {
        for (const listener of windowListeners) {
          if (listener.kind === 'message') {
            listener.run({ data });
          }
        }
      });
    },
    body,
    root,
  };
}
