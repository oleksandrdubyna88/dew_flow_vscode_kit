import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { DisplayConfig } from '../display/config';
import { clampTone, toneColour, toneControlHtml, toneCss, toneLabel, toneScript, toneStyle } from '../display/tone';
import { clampScale, offsetLabel, scalePx, ZOOM_CSS, zoomControlHtml, zoomScript, zoomStyle } from '../display/zoom';
import { RECORDED, RECORDED_OFFSETS } from './coaiFixture';
import { assertNoCr } from './lineEndings';

/**
 * For ConnectOtherAIs' own configuration the kit returns EXACTLY what coai rendered at `1056aed9`.
 *
 * <p>The expected values were COMPUTED by coai's own modules (`scripts/record-coai-display.mjs`), never
 * retyped — a retyped literal agrees with whoever typed it. Plan §1 item 2.</p>
 */

const COAI: DisplayConfig = { product: 'ConnectOtherAIs', cssPrefix: 'coai' };

const CLAMP_INPUTS: readonly unknown[] = [null, 'x', 2.9, -2.9, Infinity, Number.NaN];

test('the fixture is the one recorded from coai 1056aed9, with every offset the tests walk', () => {
  assert.match(RECORDED.source, /1056aed9/);
  assert.deepEqual(Object.keys(RECORDED.zoom).map(Number).sort((a, b) => a - b), [...RECORDED_OFFSETS]);
});

for (const [offset, expected] of Object.entries(RECORDED.zoom)) {
  test(`zoom at offset ${offset} is byte-identical to coai`, () => {
    const o = Number(offset);
    assert.equal(scalePx(o), expected.scalePx);
    assert.equal(offsetLabel(o), expected.offsetLabel);
    assert.equal(zoomControlHtml(o, COAI), expected.zoomControlHtml);
    assert.equal(zoomStyle(o), expected.zoomStyle);
    assertNoCr(zoomControlHtml(o, COAI), 'zoom control');
  });
}

for (const [offset, expected] of Object.entries(RECORDED.tone)) {
  test(`tone at offset ${offset} is byte-identical to coai`, () => {
    const o = Number(offset);
    assert.equal(toneLabel(o), expected.toneLabel);
    assert.equal(toneColour(o, COAI), expected.toneColour);
    assert.equal(toneColour(o, COAI, 'var(--vscode-editor-foreground)'), expected.toneColourEditor);
    assert.equal(toneStyle(o, COAI), expected.toneStyle);
    assert.equal(toneControlHtml(o, COAI), expected.toneControlHtml);
    assertNoCr(toneControlHtml(o, COAI), 'tone control');
  });
}

test('the scripts and stylesheets are byte-identical to coai for its config', () => {
  assert.equal(zoomScript(), RECORDED.zoomScript);
  assert.equal(ZOOM_CSS, RECORDED.ZOOM_CSS);
  assert.equal(toneScript(COAI), RECORDED.toneScript);
  assert.equal(toneCss(COAI), RECORDED.TONE_CSS);
  for (const [what, text] of [['zoom script', zoomScript()], ['zoom css', ZOOM_CSS], ['tone script', toneScript(COAI)], ['tone css', toneCss(COAI)]] as const) {
    assertNoCr(text, what);
  }
});

test('junk setting values clamp exactly as coai clamped them', () => {
  assert.deepEqual(CLAMP_INPUTS.map(clampScale), RECORDED.clamp.scale);
  assert.deepEqual(CLAMP_INPUTS.map(clampTone), RECORDED.clamp.tone);
});

test('the comparison has teeth: a step of 1.2 instead of 1.1 would not pass it', () => {
  // The refuted variant, reproduced: if the step were wrong the recorded size at +3 could not match.
  const wrongAtThree = Number((13 * Math.pow(1.2, 3)).toFixed(2));
  assert.notEqual(wrongAtThree, RECORDED.zoom['3']?.scalePx);
  assert.throws(() => assert.equal(wrongAtThree, RECORDED.zoom['3']?.scalePx));
});

test('another consumer gets its own product name and CSS prefix, and nothing of coai', () => {
  const mine: DisplayConfig = { product: 'WSL Care', cssPrefix: 'wslcare' };

  assert.match(zoomControlHtml(1, mine), /every WSL Care page/);
  assert.match(toneStyle(2, mine), /^--wslcare-text: color-mix\(in srgb, var\(--vscode-foreground\) 84%, var\(--wslcare-tone-away\) 16%\);/);
  for (const text of [zoomControlHtml(1, mine), toneControlHtml(1, mine), toneStyle(2, mine), toneScript(mine), toneCss(mine)]) {
    assert.equal(/coai|ConnectOtherAIs/.test(text), false, `coai leaked into another consumer: ${text}`);
  }
});
