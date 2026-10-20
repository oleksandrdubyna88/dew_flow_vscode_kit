/**
 * The slice of the DOM the webview components touch — and nothing else (`research/PLAN_kit_components_storybook.md`
 * §4.3).
 *
 * <p><b>Why a port and not the global `document`.</b> The kit compiles without the DOM library (`tsconfig.json`
 * keeps `lib` at ES2022), so a pure module cannot reach a document by accident. A component takes the document it
 * builds in as an argument: in a webview that is the real `document`; in a test it is the strict fake
 * (`src/test/fakeDom.ts`) or jsdom's. The interfaces are F-bounded — `E` is the element type itself — so a real
 * `Document` fits without a cast, and what a component returns is typed as the consumer's own element
 * (`HTMLElement`), ready to append.</p>
 *
 * <p><b>The surface is a contract with every consumer's harness.</b> A consumer whose page-script harness refuses
 * whatever it does not model (wsl_care's does) widens it by exactly these tags, attributes, members and events.
 * {@link KIT_TAGS}, {@link KIT_ATTRIBUTES} and {@link KIT_EVENTS} are that list as data; the kit's own strict fake
 * reads them, so a component reaching past them fails its tests by name.</p>
 */

/** The elements a component may create: a text page's, nothing that loads, runs or navigates. */
export const KIT_TAGS = ['div', 'span', 'strong', 'p', 'ul', 'li', 'button', 'input', 'table', 'thead', 'tbody', 'tr', 'th', 'td'] as const;

export type KitTag = (typeof KIT_TAGS)[number];

/** The attributes a component may set; `aria-*` and `data-kit-*` by prefix. Never `style`, `on*`, `src` or `href`. */
export const KIT_ATTRIBUTES = ['role', 'id', 'type', 'tabindex', 'scope', 'colspan'] as const;

/** The attribute prefixes a component may set besides {@link KIT_ATTRIBUTES}. */
export const KIT_ATTRIBUTE_PREFIXES = ['aria-', 'data-kit-'] as const;

/** The events a component listens for. */
export const KIT_EVENTS = ['click', 'keydown', 'input'] as const;

export type KitEventType = (typeof KIT_EVENTS)[number];

/** What a listener reads from an event: the key of a `keydown`, and the default it may prevent. */
export interface KitEvent {
  readonly key?: string;
  preventDefault(): void;
}

/** An element as the components use it. `E` is the element type itself, so `appendChild` takes the consumer's own. */
export interface KitElement<E> {
  readonly tagName: string;
  textContent: string | null;
  className: string;
  /** lib.dom types it `boolean | "until-found"`; the components only ever write a boolean. */
  hidden: boolean | string;
  setAttribute(name: string, value: string): void;
  /** Re-appending a child that is already attached MOVES it — which is how a sort reorders rows. */
  appendChild(child: E): unknown;
  addEventListener(type: KitEventType, listener: (event: KitEvent) => void): void;
  focus(): void;
}

/** The document a component builds in. */
export interface KitDocument<E> {
  createElement(tag: KitTag): E;
}

/** A new element with its class and, when given, its text — text is always `textContent`, never parsed as markup. */
export function element<E extends KitElement<E>>(doc: KitDocument<E>, tag: KitTag, className: string, text?: string): E {
  const made = doc.createElement(tag);
  made.className = className;
  if (text !== undefined) {
    made.textContent = text;
  }

  return made;
}

/** Sets every attribute of `attributes` on `target`, in order. */
export function attributes<E extends KitElement<E>>(target: E, values: Readonly<Record<string, string>>): E {
  for (const [name, value] of Object.entries(values)) {
    target.setAttribute(name, value);
  }

  return target;
}

/** Appends every child to `parent`, in order, and answers the parent. */
export function children<E extends KitElement<E>>(parent: E, ...added: readonly E[]): E {
  for (const child of added) {
    parent.appendChild(child);
  }

  return parent;
}

/**
 * An input's current value. Read through an `unknown` widening and a `typeof` check rather than a cast to a DOM
 * type: the port does not declare `value` (a plain element has none), and anything but a string reads as empty.
 */
export function valueOf(input: object): string {
  const value: unknown = Reflect.get(input, 'value');

  return typeof value === 'string' ? value : '';
}

/** Writes an input's value, so a filter set from code shows in the box too. */
export function writeValue(input: object, value: string): void {
  Reflect.set(input, 'value', value);
}
