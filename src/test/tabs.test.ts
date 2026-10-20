import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import type { KitElement } from '../components/dom';
import { STATUS_TONES, toneGlyph } from '../components/status';
import { createTabs, type TabsOptions } from '../components/tabs';
import { onEveryDocument, type Driver } from './domDrivers';

/**
 * `Tabs`, RUN on the strict fake and on jsdom (`research/PLAN_kit_components_storybook.md` §5.2, items 1–6): the WAI-ARIA
 * wiring, the roving tabindex, the keys, the click, the status words, and every refusal at the door.
 */

function options<E extends KitElement<E>>(driver: Driver<E>, overrides: Partial<TabsOptions<E>> = {}): TabsOptions<E> {
  return {
    idPrefix: 'side',
    label: 'Sides',
    tabs: [
      { id: 'linux', label: 'Linux', content: driver.make('p', 'linux panel'), status: { tone: 'warning', word: '2 warnings' } },
      { id: 'windows', label: 'Windows', content: driver.make('p', 'windows panel') },
      { id: 'stats', label: 'Statistics', content: driver.make('p', 'stats panel'), status: { tone: 'ok', word: 'All fine' } },
    ],
    ...overrides,
  };
}

onEveryDocument((make, name) => {
  describe(`Tabs on the ${name}`, () => {
    test('a tablist of tabs, each controlling its panel by id, each panel labelled by its tab; one selected, its panel the only one shown', () => {
      const driver = make();
      const root = driver.attach(createTabs(driver.doc, options(driver)).root);
      const list = root.one('[role="tablist"]');
      assert.equal(list.attribute('aria-label'), 'Sides');
      const tabs = list.all('button[role="tab"]');
      assert.deepEqual(tabs.map((tab) => tab.attribute('id')), ['side-tab-linux', 'side-tab-windows', 'side-tab-stats']);
      for (const tab of tabs) {
        assert.equal(tab.attribute('type'), 'button');
        const panel = root.one(`[id="${tab.attribute('aria-controls') ?? ''}"]`);
        assert.equal(panel.attribute('role'), 'tabpanel');
        assert.equal(panel.attribute('aria-labelledby'), tab.attribute('id'));
        assert.equal(panel.attribute('tabindex'), '0');
      }
      assert.deepEqual(tabs.map((tab) => tab.attribute('aria-selected')), ['true', 'false', 'false']);
      assert.deepEqual(root.all('[role="tabpanel"]').map((panel) => panel.hidden), [false, true, true]);
      assert.equal(root.one('[role="tabpanel"][data-kit-panel="linux"]').text, 'linux panel');
    });

    test('the roving tabindex: 0 on the selected tab only, -1 on every other', () => {
      const driver = make();
      const root = driver.attach(createTabs(driver.doc, options(driver, { selected: 'windows' })).root);
      assert.deepEqual(root.all('[role="tab"]').map((tab) => tab.attribute('tabindex')), ['-1', '0', '-1']);
    });

    test('ArrowRight from the last tab wraps to the first, ArrowLeft from the first to the last, Home and End go to the ends — each selecting, focusing and preventing the default', () => {
      const driver = make();
      const view = createTabs(driver.doc, options(driver, { selected: 'stats' }));
      const root = driver.attach(view.root);
      const tab = (id: string) => root.one(`[role="tab"][data-kit-tab="${id}"]`);
      const press = (key: string, expected: string): void => {
        const prevented = driver.key(tab(view.selected()), key);
        assert.equal(prevented, true, `${key} did not prevent its default`);
        assert.equal(view.selected(), expected, `${key} selected ${view.selected()}`);
        assert.equal(tab(expected).attribute('aria-selected'), 'true');
        assert.equal(tab(expected).attribute('tabindex'), '0');
        assert.ok(driver.focused()?.is(tab(expected)), `${key} did not move the focus to ${expected}`);
        assert.equal(root.one(`[data-kit-panel="${expected}"]`).hidden, false);
      };
      press('ArrowRight', 'linux');
      press('ArrowRight', 'windows');
      press('ArrowLeft', 'linux');
      press('ArrowLeft', 'stats');
      press('Home', 'linux');
      press('End', 'stats');
    });

    test('any other key changes nothing and prevents nothing — a letter, Enter, toString', () => {
      const driver = make();
      const view = createTabs(driver.doc, options(driver));
      const root = driver.attach(view.root);
      for (const key of ['a', 'Enter', 'toString', 'ArrowDown']) {
        assert.equal(driver.key(root.one('[role="tab"][data-kit-tab="linux"]'), key), false, key);
        assert.equal(view.selected(), 'linux', key);
      }
    });

    test('a click selects the tab and tells onSelect once; select() from code is silent; clicking the selected tab tells nothing', () => {
      const driver = make();
      const heard: string[] = [];
      const view = createTabs(driver.doc, options(driver, { onSelect: (id) => { heard.push(id); } }));
      const root = driver.attach(view.root);
      driver.click(root.one('[role="tab"][data-kit-tab="windows"]'));
      assert.equal(view.selected(), 'windows');
      assert.deepEqual(root.all('[role="tabpanel"]').map((panel) => panel.hidden), [true, false, true]);
      driver.click(root.one('[role="tab"][data-kit-tab="windows"]'));
      view.select('stats');
      assert.equal(view.selected(), 'stats');
      assert.equal(root.one('[data-kit-panel="stats"]').hidden, false);
      driver.key(root.one('[role="tab"][data-kit-tab="stats"]'), 'Home');
      assert.deepEqual(heard, ['windows', 'linux']);
      assert.throws(() => { view.select('nope'); }, /there is no tab "nope"; the tabs are linux, windows, stats/);
    });

    test('every tone shows its glyph, aria-hidden, AND its word — colour is never the only signal', () => {
      const driver = make();
      const tabs = STATUS_TONES.map((tone) => ({ id: tone, label: tone, content: driver.make('p', tone), status: { tone, word: `word ${tone}` } }));
      const root = driver.attach(createTabs(driver.doc, { idPrefix: 't', label: 'Tones', tabs }).root);
      for (const tone of STATUS_TONES) {
        const mark = root.one(`[data-kit-tab="${tone}"]`).one('.kit-mark');
        assert.ok(mark.classes.includes(`kit-mark--${tone}`));
        const glyph = mark.one('.kit-mark__glyph');
        assert.equal(glyph.text, toneGlyph(tone));
        assert.equal(glyph.attribute('aria-hidden'), 'true');
        assert.equal(mark.one('.kit-mark__word').text, `word ${tone}`);
      }
    });

    test('setStatus replaces a tab\'s mark live and removes it with null', () => {
      const driver = make();
      const view = createTabs(driver.doc, options(driver));
      const root = driver.attach(view.root);
      view.setStatus('windows', { tone: 'critical', word: 'Daemon down' });
      assert.equal(root.one('[data-kit-tab="windows"]').one('.kit-mark--critical').text, `${toneGlyph('critical')}Daemon down`);
      view.setStatus('linux', { tone: 'ok', word: 'Fine' });
      assert.equal(root.one('[data-kit-tab="linux"]').all('.kit-mark').length, 1);
      assert.equal(root.one('[data-kit-tab="linux"]').one('.kit-mark__word').text, 'Fine');
      view.setStatus('linux', null);
      assert.equal(root.one('[data-kit-tab="linux"]').all('.kit-mark').length, 0);
      assert.equal(root.one('[data-kit-tab="linux"]').text, 'Linux');
      assert.throws(() => { view.setStatus('linux', { tone: 'red' as never, word: 'x' }); }, /tone must be one of neutral, info, ok, warning, critical/);
      assert.throws(() => { view.setStatus('linux', { tone: 'ok', word: '' }); }, /word must be non-empty text/);
    });

    test('refused at the door, each naming what: no tabs, a repeated or malformed id, an empty label, an unknown selected, a bad prefix, a bad mark, no content', () => {
      const driver = make();
      const base = options(driver);
      const first = base.tabs[0];
      assert.ok(first !== undefined);
      const cases: [Partial<TabsOptions<typeof first.content>>, RegExp][] = [
        [{ tabs: [] }, /Tabs tabs must be a non-empty list/],
        [{ tabs: [first, first] }, /the id "linux" is used twice/],
        [{ tabs: [{ ...first, id: 'Linux' }] }, /tabs\[0\]\.id must match/],
        [{ tabs: [{ ...first, label: ' ' }] }, /tabs\[0\]\.label must be non-empty text/],
        [{ label: '' }, /Tabs label must be non-empty text/],
        [{ idPrefix: '1x' }, /Tabs idPrefix must match/],
        [{ selected: 'nope' }, /Tabs selected must be one of linux, windows, stats, got "nope"/],
        [{ tabs: [{ ...first, status: { tone: 'warning', word: '' } }] }, /tabs\[0\]\.status\.word must be non-empty text/],
        [{ tabs: [{ ...first, status: { tone: 'amber' as never, word: 'x' } }] }, /tabs\[0\]\.status\.tone must be one of/],
        [{ tabs: [{ ...first, content: null as never }] }, /tabs\[0\]\.content must be an element/],
      ];
      for (const [overrides, message] of cases) {
        assert.throws(() => createTabs(driver.doc, { ...base, ...overrides }), (error: unknown) => error instanceof TypeError && message.test(error.message), String(message));
      }
    });
  });
});
