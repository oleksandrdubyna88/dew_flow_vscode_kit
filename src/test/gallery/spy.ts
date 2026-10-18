import type { KitDocument, KitElement, KitEvent } from '../../components/dom';

/**
 * A document that WATCHES the elements a component builds, so a gallery case can do what a person does — press the
 * reveal button of row 2 — without a page to dispatch an event in (`todo/PLAN_kit_components_storybook.md` §4.9). The
 * strict fake and a real browser both refuse to dispatch at an element that is not in a page, and a gallery case is
 * rendered BEFORE it is placed in one; the component's own click listener, recorded here as it is registered, is the
 * one thing that needs no page. Test code: it never ships.
 */

interface Record_ {
  readonly attributes: Map<string, string>;
  readonly clicks: ((event: KitEvent) => void)[];
}

export interface Spy<E extends KitElement<E>> {
  /** Hand this to the component in place of the real document. */
  readonly doc: KitDocument<E>;
  /** The real element behind one the spy document made - what the case returns to its page. */
  unwrap(view: E): E;
  /** Runs the click listeners of every element that carries `attribute="value"`, as a person's click would. */
  press(attribute: string, value: string): void;
}

type Members = Record<PropertyKey, unknown>;

export function spyOn<E extends KitElement<E>>(doc: KitDocument<E>): Spy<E> {
  const records = new Map<E, Record_>();
  const reals = new WeakMap<object, E>();

  const wrap = (real: E, record: Record_): E => {
    const proxy: E = new Proxy(real, {
      get: (target, key) => {
        const value = (target as unknown as Members)[key];
        if (typeof value !== 'function') {
          return value;
        }
        const call = value as (...args: unknown[]) => unknown;
        if (key === 'setAttribute') {
          return (name: string, text: string): void => { record.attributes.set(name, text); call.call(target, name, text); };
        }
        if (key === 'addEventListener') {
          return (type: string, listener: (event: KitEvent) => void): void => {
            if (type === 'click') {
              record.clicks.push(listener);
            }
            call.call(target, type, listener);
          };
        }
        if (key === 'appendChild') {
          return (child: E): unknown => call.call(target, reals.get(child) ?? child);
        }

        return call.bind(target);
      },
      set: (target, key, value) => {
        (target as unknown as Members)[key] = value;

        return true;
      },
    });
    reals.set(proxy, real);

    return proxy;
  };

  return {
    doc: {
      createElement: (tag) => {
        const real = doc.createElement(tag);
        const record: Record_ = { attributes: new Map(), clicks: [] };
        records.set(real, record);

        return wrap(real, record);
      },
    },
    unwrap: (view) => reals.get(view) ?? view,
    press: (attribute, value) => {
      for (const record of records.values()) {
        if (record.attributes.get(attribute) === value) {
          record.clicks.forEach((listener) => { listener({ preventDefault: () => undefined }); });
        }
      }
    },
  };
}
