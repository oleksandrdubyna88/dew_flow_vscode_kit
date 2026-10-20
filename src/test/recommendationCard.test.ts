import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import type { KitElement } from '../components/dom';
import { createRecommendationCard, type RecommendationOptions } from '../components/recommendationCard';
import { STATUS_TONES, toneGlyph } from '../components/status';
import { onEveryDocument, type Driver } from './domDrivers';

/**
 * `RecommendationCard`, RUN on the strict fake and on jsdom (`todo/PLAN_kit_components_storybook.md` §5.2, items
 * 14–15): the glyph and its word, the sentence, the consumer's ONE button placed as given, the evidence — and the
 * refusals.
 */

onEveryDocument(<E extends KitElement<E>>(make: () => Driver<E>, name: string) => {
  const card = (driver: Driver<E>, overrides: Partial<RecommendationOptions<E>> = {}): E => createRecommendationCard(driver.doc, {
    tone: 'warning',
    word: 'Warning',
    sentence: 'Memory is low: 6 % available. Drop caches to free about 2.1 GiB.',
    ...overrides,
  });

  describe(`RecommendationCard on the ${name}`, () => {
    test('every tone: its class, its glyph aria-hidden, its word in a strong, then the sentence', () => {
      const driver = make();
      for (const tone of STATUS_TONES) {
        const root = driver.attach(card(driver, { tone, word: `word ${tone}` }));
        assert.ok(root.classes.includes('kit-rec') && root.classes.includes(`kit-rec--${tone}`), root.classes.join(' '));
        const glyph = root.one('.kit-rec__glyph');
        assert.equal(glyph.text, toneGlyph(tone));
        assert.equal(glyph.attribute('aria-hidden'), 'true');
        assert.equal(root.one('strong').text, `word ${tone}`);
        assert.equal(root.one('p.kit-rec__sentence').text, 'Memory is low: 6 % available. Drop caches to free about 2.1 GiB.');
        assert.equal(root.all('.kit-rec__action').length, 0);
        assert.equal(root.all('ul').length, 0);
      }
    });

    test('the consumer\'s button is placed as given — the same element, its own listener still the one that runs', () => {
      const driver = make();
      const button = driver.make('button', 'Drop caches');
      let pressed = 0;
      button.addEventListener('click', () => { pressed += 1; });
      const root = driver.attach(card(driver, { action: button }));
      const placed = root.one('.kit-rec__action').one('button');
      assert.ok(placed.is(driver.node(button)));
      driver.click(placed);
      assert.equal(pressed, 1);
    });

    test('the evidence is a labelled list, in the given order; the label defaults to Evidence', () => {
      const driver = make();
      const root = driver.attach(card(driver, { evidence: ['WSL RAM available 6 %', 'Swap 92 % used'] }));
      assert.equal(root.one('.kit-rec__evidence-label').text, 'Evidence');
      assert.deepEqual(root.one('ul.kit-rec__evidence').all('li').map((li) => li.text), ['WSL RAM available 6 %', 'Swap 92 % used']);
      const labelled = driver.attach(card(driver, { evidence: ['x'], evidenceLabel: 'Why' }));
      assert.equal(labelled.one('.kit-rec__evidence-label').text, 'Why');
    });

    test('refused, each naming what: an action that is not a BUTTON, an unknown tone, an empty word, sentence, evidence entry or label', () => {
      const driver = make();
      const cases: [Partial<RecommendationOptions<E>>, RegExp][] = [
        [{ action: driver.make('div', 'not a button') }, /action must be a BUTTON element, got DIV/],
        [{ tone: 'amber' as never }, /tone must be one of neutral, info, ok, warning, critical, got "amber"/],
        [{ word: '' }, /word must be non-empty text/],
        [{ sentence: '  ' }, /sentence must be non-empty text/],
        [{ evidence: ['fine', ''] }, /evidence\[1\] must be non-empty text/],
        [{ evidence: ['fine'], evidenceLabel: '' }, /evidenceLabel must be non-empty text/],
      ];
      for (const [overrides, message] of cases) {
        assert.throws(() => card(driver, overrides), (error: unknown) => error instanceof TypeError && message.test(error.message), String(message));
      }
    });
  });
});

test('the five tones each have their own glyph — none borrowed, none blank', () => {
  const glyphs = STATUS_TONES.map(toneGlyph);
  assert.equal(new Set(glyphs).size, STATUS_TONES.length);
  assert.ok(glyphs.every((glyph) => glyph.trim().length > 0));
});
