import { id, list, repeated, text } from './checks';
import { attributes, children, element, type KitDocument, type KitElement, type KitEvent } from './dom';
import { checkedMark, markElement, type StatusMark } from './status';

/**
 * `Tabs` — the WAI-ARIA tabs pattern with automatic activation (`research/PLAN_kit_components_storybook.md` §4.5).
 *
 * <p>A `div role=tablist` of `button role=tab` elements, each with an id, `aria-controls` naming its panel,
 * `aria-selected`, and a roving `tabindex` — `0` on the selected tab, `-1` on the others, so Tab enters the list on
 * the selected tab and leaves it for the panel. Each panel is a `div role=tabpanel`, labelled by its tab, focusable
 * (`tabindex=0`) and `hidden` unless its tab is selected. Arrow keys move and select, wrapping; Home and End go to
 * the ends. A tab may carry a status — a tone and its WORD (`status.ts`) — replaced live with `setStatus`.</p>
 *
 * <p>Everything a reader sees is the consumer's: the labels, the words, the panels' contents. `onSelect` hears a
 * PERSON's selection only; `select()` from code is silent, so a consumer that mirrors the selection into its own
 * state cannot loop.</p>
 */

/** One tab as a consumer describes it. */
export interface TabSpec<E> {
  /** `[a-z][a-z0-9-]*`, unique among the tabs. */
  readonly id: string;
  readonly label: string;
  /** What the tab's panel shows — the consumer's own element. */
  readonly content: E;
  readonly status?: StatusMark;
}

export interface TabsOptions<E> {
  /** `[a-z][a-z0-9-]*`, unique per page: every tab and panel id is derived from it. */
  readonly idPrefix: string;
  /** The tablist's accessible name. */
  readonly label: string;
  readonly tabs: readonly TabSpec<E>[];
  /** The tab selected at first; the first tab when absent. */
  readonly selected?: string;
  /** Told the tab's id when a PERSON selects another tab. */
  readonly onSelect?: (id: string) => void;
}

export interface TabsView<E> {
  readonly root: E;
  /** Selects a tab from code — `onSelect` is not told. */
  select(id: string): void;
  /** The selected tab's id. */
  selected(): string;
  /** Replaces a tab's status, or removes it with `null`. */
  setStatus(id: string, mark: StatusMark | null): void;
}

interface BuiltTab<E> {
  readonly id: string;
  readonly tab: E;
  readonly panel: E;
  readonly slot: E;
}

/**
 * The keys the tablist answers, each mapping the selected index (of `count`) to the next one. A `Map`, not an
 * object: a key named `toString` must find nothing, not `Object.prototype`'s.
 */
const KEYS: ReadonlyMap<string, (index: number, count: number) => number> = new Map([
  ['ArrowRight', (index: number, count: number) => (index + 1) % count],
  ['ArrowLeft', (index: number, count: number) => (index - 1 + count) % count],
  ['Home', () => 0],
  ['End', (_index: number, count: number) => count - 1],
]);

/** The options, checked at the door: every refusal names what. */
function checked<E>(options: TabsOptions<E>): TabsOptions<E> {
  id(options.idPrefix, 'Tabs idPrefix');
  text(options.label, 'Tabs label');
  const tabs = list(options.tabs, 'Tabs tabs');
  const ids = tabs.map((tab, index) => id(tab.id, `Tabs tabs[${index}].id`));
  const twice = repeated(ids);
  if (twice !== undefined) {
    throw new TypeError(`Tabs tabs: the id "${twice}" is used twice.`);
  }
  tabs.forEach((tab, index) => checkedTab(tab, index));
  if (options.selected !== undefined && !ids.includes(options.selected)) {
    throw new TypeError(`Tabs selected must be one of ${ids.join(', ')}, got "${String(options.selected)}".`);
  }

  return options;
}

function checkedTab<E>(tab: TabSpec<E>, index: number): void {
  text(tab.label, `Tabs tabs[${index}].label`);
  if (typeof tab.content !== 'object' || tab.content === null) {
    throw new TypeError(`Tabs tabs[${index}].content must be an element.`);
  }
  if (tab.status !== undefined) {
    checkedMark(tab.status, `Tabs tabs[${index}].status`);
  }
}

function buildTab<E extends KitElement<E>>(doc: KitDocument<E>, prefix: string, spec: TabSpec<E>): BuiltTab<E> {
  const tabId = `${prefix}-tab-${spec.id}`;
  const panelId = `${prefix}-panel-${spec.id}`;
  const slot = element(doc, 'span', 'kit-tab__status');
  const tab = attributes(element(doc, 'button', 'kit-tab'), {
    type: 'button', role: 'tab', id: tabId, 'aria-controls': panelId, 'data-kit-tab': spec.id,
  });
  children(tab, element(doc, 'span', 'kit-tab__label', spec.label), slot);
  const panel = attributes(element(doc, 'div', 'kit-tabs__panel'), {
    role: 'tabpanel', id: panelId, 'aria-labelledby': tabId, tabindex: '0', 'data-kit-panel': spec.id,
  });
  panel.appendChild(spec.content);
  if (spec.status !== undefined) {
    slot.appendChild(markElement(doc, spec.status));
  }

  return { id: spec.id, tab, panel, slot };
}

/** Paints one tab and its panel as selected or not. */
function paint<E extends KitElement<E>>(built: BuiltTab<E>, on: boolean): void {
  built.tab.className = on ? 'kit-tab kit-tab--selected' : 'kit-tab';
  built.tab.setAttribute('aria-selected', on ? 'true' : 'false');
  built.tab.setAttribute('tabindex', on ? '0' : '-1');
  built.panel.hidden = !on;
}

/** The tablist, its tabs and panels assembled under one root. */
function assemble<E extends KitElement<E>>(doc: KitDocument<E>, label: string, built: readonly BuiltTab<E>[]): { root: E; tablist: E } {
  const tablist = attributes(element(doc, 'div', 'kit-tabs__list'), { role: 'tablist', 'aria-label': label });
  children(tablist, ...built.map((entry) => entry.tab));
  const root = children(element(doc, 'div', 'kit-tabs'), tablist, ...built.map((entry) => entry.panel));

  return { root, tablist };
}

export function createTabs<E extends KitElement<E>>(doc: KitDocument<E>, options: TabsOptions<E>): TabsView<E> {
  const spec = checked(options);
  const built = spec.tabs.map((tab) => buildTab(doc, spec.idPrefix, tab));
  const { root, tablist } = assemble(doc, spec.label, built);
  let current = spec.selected ?? built[0]?.id ?? '';
  const show = (target: string): void => {
    current = target;
    built.forEach((entry) => { paint(entry, entry.id === target); });
  };
  const choose = (target: string): void => {
    if (target !== current) {
      show(target);
      spec.onSelect?.(target);
    }
  };
  show(current);
  built.forEach((entry) => { entry.tab.addEventListener('click', () => { choose(entry.id); }); });
  tablist.addEventListener('keydown', (event) => { onKey(event, built, () => current, choose); });

  return {
    root,
    select: (target) => { show(known(built, target)); },
    selected: () => current,
    setStatus: (target, mark) => { status(doc, built, target, mark); },
  };
}

/** A key on the tablist: an arrow, Home or End selects and focuses the next tab; any other key does nothing. */
function onKey<E extends KitElement<E>>(event: KitEvent, built: readonly BuiltTab<E>[], current: () => string, choose: (id: string) => void): void {
  const step = KEYS.get(event.key ?? '');
  if (step === undefined) {
    return;
  }
  event.preventDefault();
  const next = built[step(built.findIndex((entry) => entry.id === current()), built.length)];
  if (next !== undefined) {
    choose(next.id);
    next.tab.focus();
  }
}

/** `target` as one of the tabs' ids, or a `TypeError` naming them. */
function known<E>(built: readonly BuiltTab<E>[], target: string): string {
  if (!built.some((entry) => entry.id === target)) {
    throw new TypeError(`Tabs: there is no tab "${String(target)}"; the tabs are ${built.map((entry) => entry.id).join(', ')}.`);
  }

  return target;
}

function status<E extends KitElement<E>>(doc: KitDocument<E>, built: readonly BuiltTab<E>[], target: string, mark: StatusMark | null): void {
  const entry = built.find((candidate) => candidate.id === known(built, target));
  if (entry === undefined) {
    return;
  }
  entry.slot.textContent = '';
  if (mark !== null) {
    entry.slot.appendChild(markElement(doc, checkedMark(mark, `Tabs setStatus("${target}")`)));
  }
}
