import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createDisplayConfig } from '../display/config';
import { readPress, type PressReading } from '../display/press';
import { toneScript } from '../display/tone';
import { zoomScript } from '../display/zoom';
import { Node, runPageScript } from './pageHarness';

/**
 * The webview → host trust boundary: a message a page posted is VALIDATED before it can reach a write.
 * Only a known `type`, only a finite numeric `delta` reduced to one step, anything else refused with a
 * typed reason — and never a throw, whatever the page sent (plan §1, gate round 1).
 */

const accepted = (kind: 'zoom' | 'tone', step: -1 | 1): PressReading => ({ accepted: true, press: { kind, step } });
const rejected = (reason: Extract<PressReading, { accepted: false }>['reason']): PressReading => ({ accepted: false, reason });

interface Row {
  readonly what: string;
  readonly message: unknown;
  readonly expected: PressReading;
}

/** One row per input shape — the table the gate asked for. */
const TABLE: readonly Row[] = [
  { what: 'a zoom step up, as the kit page posts it', message: { type: 'zoom', delta: 1, field: '' }, expected: accepted('zoom', 1) },
  { what: 'a tone step down, as the kit page posts it', message: { type: 'tone', delta: -1, field: '' }, expected: accepted('tone', -1) },
  { what: 'no field at all — the shape a consumer parser of its own hands over', message: { type: 'zoom', delta: 1 }, expected: accepted('zoom', 1) },
  { what: 'a huge delta is ONE step, never a jump to a bound', message: { type: 'zoom', delta: 99 }, expected: accepted('zoom', 1) },
  { what: 'the largest finite number is still one step', message: { type: 'tone', delta: -Number.MAX_VALUE }, expected: accepted('tone', -1) },
  { what: 'a fraction below one whole step is not a press (coai textControlFrom)', message: { type: 'zoom', delta: 0.5 }, expected: rejected('no-step') },
  { what: 'zero is not a press — nothing is written', message: { type: 'zoom', delta: 0 }, expected: rejected('no-step') },
  { what: 'negative zero is not a press', message: { type: 'zoom', delta: -0 }, expected: rejected('no-step') },
  { what: 'null', message: null, expected: rejected('not-an-object') },
  { what: 'undefined', message: undefined, expected: rejected('not-an-object') },
  { what: 'a string', message: 'zoom', expected: rejected('not-an-object') },
  { what: 'a number', message: 1, expected: rejected('not-an-object') },
  { what: 'an array', message: ['zoom', 1], expected: rejected('not-an-object') },
  { what: 'an empty object', message: {}, expected: rejected('unknown-type') },
  { what: 'a type nobody contributes', message: { type: 'zoomm', delta: 1 }, expected: rejected('unknown-type') },
  { what: '__proto__ as the type', message: { type: '__proto__', delta: 1 }, expected: rejected('unknown-type') },
  { what: 'constructor as the type', message: { type: 'constructor', delta: 1 }, expected: rejected('unknown-type') },
  { what: 'a type that is not a string', message: { type: ['zoom'], delta: 1 }, expected: rejected('unknown-type') },
  { what: 'a type reached only through the prototype', message: Object.create({ type: 'zoom', delta: 1 }) as unknown, expected: rejected('unknown-type') },
  { what: 'no delta', message: { type: 'zoom' }, expected: rejected('delta-not-a-number') },
  { what: 'a numeric string delta', message: { type: 'zoom', delta: '1' }, expected: rejected('delta-not-a-number') },
  { what: 'NaN', message: { type: 'zoom', delta: Number.NaN }, expected: rejected('delta-not-a-number') },
  { what: 'Infinity', message: { type: 'zoom', delta: Number.POSITIVE_INFINITY }, expected: rejected('delta-not-a-number') },
  { what: '-Infinity', message: { type: 'tone', delta: Number.NEGATIVE_INFINITY }, expected: rejected('delta-not-a-number') },
  { what: 'an object with a valueOf', message: { type: 'zoom', delta: { valueOf: () => 1 } }, expected: rejected('delta-not-a-number') },
  { what: 'a boolean delta', message: { type: 'zoom', delta: true }, expected: rejected('delta-not-a-number') },
  { what: 'a field that is not empty', message: { type: 'zoom', delta: 1, field: 'x' }, expected: rejected('field') },
  { what: 'a field that is not a string', message: { type: 'zoom', delta: 1, field: 0 }, expected: rejected('field') },
];

for (const row of TABLE) {
  test(`readPress: ${row.what}`, () => {
    assert.deepEqual(readPress(row.message), row.expected);
  });
}

test('an own __proto__ member from JSON is data, not a prototype: the own type wins and the message is read as posted', () => {
  const message: unknown = JSON.parse('{"__proto__":{"type":"zoom","delta":1},"type":"tone","delta":-1}');

  assert.deepEqual(readPress(message), accepted('tone', -1));
});

test('readPress never throws, whatever it is handed', () => {
  for (const row of TABLE) {
    assert.doesNotThrow(() => readPress(row.message), row.what);
  }
  assert.doesNotThrow(() => readPress(Object.create(null)));
  assert.doesNotThrow(() => readPress(Symbol('zoom')));
  assert.doesNotThrow(() => readPress(() => undefined));
});

/**
 * The contract has two sides — the page script POSTS, the host READS — and a test on each side alone
 * would compare each list to itself (`common.testing`). This runs the kit's own page scripts and feeds
 * what they posted into the validator: the one live check between the two.
 */
test('what the kit\'s own zoom and tone pages post is exactly what the host accepts', () => {
  const config = createDisplayConfig('WSL Care', 'wslcare');
  const smaller = new Node({ zoom: '-1' }, 'BUTTON');
  const larger = new Node({ zoom: '1' }, 'BUTTON');
  const dimmer = new Node({ tone: '-1' }, 'BUTTON');
  const brighter = new Node({ tone: '1' }, 'BUTTON');
  const page = runPageScript(
    `const vscode = acquireVsCodeApi();\n${zoomScript()}\n${toneScript(config)}`,
    { 'button[data-zoom]': [smaller, larger], 'button[data-tone]': [dimmer, brighter] },
    { zoomOffset: new Node({}, 'SPAN'), toneOffset: new Node({}, 'SPAN') },
  );

  larger.click();
  smaller.click();
  brighter.click();
  dimmer.click();

  assert.deepEqual(page.posted.map(readPress), [
    accepted('zoom', 1),
    accepted('zoom', -1),
    accepted('tone', 1),
    accepted('tone', -1),
  ]);
});
