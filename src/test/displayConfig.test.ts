import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createDisplayConfig } from '../display/config';
import { toneCss, toneScript, toneStyle } from '../display/tone';

/**
 * The CSS prefix reaches a stylesheet AND a page script unescaped, so it is validated where a config is
 * MADE — a consumer cannot hand the controls a prefix that closes a rule or a string (gate, epic 1 code
 * round, finding 6: `isUsablePrefix` existed and nothing called it).
 */

const HOSTILE = ['x;}body{color:red', "x');alert(1);//", 'X', '', '-coai', 'co ai', 'coai\n'];

for (const prefix of HOSTILE) {
  test(`a prefix that could break out of a rule or a string is refused: ${JSON.stringify(prefix)}`, () => {
    assert.throws(() => createDisplayConfig('WSL Care', prefix), /CSS prefix/);
  });
}

test('a plain lowercase prefix is accepted and used verbatim', () => {
  const config = createDisplayConfig('WSL Care', 'wslcare');

  assert.equal(config.cssPrefix, 'wslcare');
  assert.match(toneStyle(1, config), /^--wslcare-text: /);
  assert.match(toneCss(config), /--wslcare-tone-away/);
  assert.match(toneScript(config), /'--wslcare-text'/);
});

test('the controls refuse a config that did not come from the factory', () => {
  // A plain object literal skips the validation; the type alone cannot stop it at run time.
  const forged = { product: 'x', cssPrefix: 'x;}body{color:red' } as unknown as Parameters<typeof toneStyle>[1];

  assert.throws(() => toneStyle(1, forged), /CSS prefix/);
  assert.throws(() => toneCss(forged), /CSS prefix/);
  assert.throws(() => toneScript(forged), /CSS prefix/);
});
