import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createDisplayConfig } from '../display/config';
import { stampTranslations } from '../help/bootstrap';
import { createCatalog } from '../help/catalog';
import { readHelpMessage, type HelpMessageReading } from '../help/messages';
import { renderHelpPage } from '../help/page';
import { TRANSLATED_LANGUAGES, type HelpLanguage } from '../help/types';
import { RECORDED_HELP_PAGE as PAGE } from './coaiFixture';
import { Node, runPageScript } from './pageHarness';

/**
 * The help page's half of the webview → host trust boundary: a posted message is read as a press (the
 * display rule, unchanged), as a language — a string the CATALOG offers, nothing else — or refused with
 * a typed reason, and the reader never throws whatever the page sent.
 */

const ALL: readonly HelpLanguage[] = ['en', 'ru', 'uk', 'de', 'es'];
const TWO: readonly HelpLanguage[] = ['en', 'ru'];

const language = (code: HelpLanguage): HelpMessageReading => ({ accepted: true, action: { kind: 'language', language: code } });
const press = (kind: 'zoom' | 'tone', step: -1 | 1): HelpMessageReading => ({ accepted: true, action: { kind: 'press', press: { kind, step } } });
const refused = (reason: Extract<HelpMessageReading, { accepted: false }>['reason']): HelpMessageReading => ({ accepted: false, reason });

interface Row {
  readonly what: string;
  readonly message: unknown;
  readonly offered?: readonly HelpLanguage[];
  readonly expected: HelpMessageReading;
}

const TABLE: readonly Row[] = [
  { what: 'a language the page posts, as the kit page posts it', message: { type: 'language', language: 'ru', field: '' }, expected: language('ru') },
  { what: 'English, with no field at all', message: { type: 'language', language: 'en' }, expected: language('en') },
  { what: 'a language the help has but THIS catalog does not offer', message: { type: 'language', language: 'de' }, offered: TWO, expected: refused('language-not-offered') },
  { what: 'a language the help does not have', message: { type: 'language', language: 'fr' }, expected: refused('language-not-offered') },
  { what: 'a language in the wrong case', message: { type: 'language', language: 'RU' }, expected: refused('language-not-offered') },
  { what: 'a language that is not a string', message: { type: 'language', language: ['ru'] }, expected: refused('language-not-offered') },
  { what: 'no language at all', message: { type: 'language' }, expected: refused('language-not-offered') },
  { what: 'constructor as the language', message: { type: 'language', language: 'constructor' }, expected: refused('language-not-offered') },
  { what: '__proto__ as the language', message: { type: 'language', language: '__proto__' }, expected: refused('language-not-offered') },
  { what: 'a language with a field that is not empty', message: { type: 'language', language: 'ru', field: 'x' }, expected: refused('field') },
  { what: 'a language with a field that is not a string', message: { type: 'language', language: 'ru', field: 0 }, expected: refused('field') },
  { what: 'a zoom press — the display rule, unchanged', message: { type: 'zoom', delta: 1, field: '' }, expected: press('zoom', 1) },
  { what: 'a tone press of 99 is one step', message: { type: 'tone', delta: -99 }, expected: press('tone', -1) },
  { what: 'a sub-step press is no press', message: { type: 'tone', delta: -0.5 }, expected: refused('no-step') },
  { what: 'a press with a numeric string delta', message: { type: 'zoom', delta: '1' }, expected: refused('delta-not-a-number') },
  { what: 'a press with a field', message: { type: 'zoom', delta: 1, field: 'x' }, expected: refused('field') },
  { what: 'a type nobody contributes', message: { type: 'theme', value: 'dark' }, expected: refused('unknown-type') },
  { what: 'an empty object', message: {}, expected: refused('unknown-type') },
  { what: 'a type that is not a string', message: { type: ['language'], language: 'ru' }, expected: refused('unknown-type') },
  { what: 'a type reached only through the prototype', message: Object.create({ type: 'language', language: 'ru' }) as unknown, expected: refused('unknown-type') },
  { what: 'null', message: null, expected: refused('not-an-object') },
  { what: 'a string', message: 'language', expected: refused('not-an-object') },
  { what: 'an array', message: ['language', 'ru'], expected: refused('not-an-object') },
  { what: 'a number', message: 1, expected: refused('not-an-object') },
];

for (const row of TABLE) {
  test(`readHelpMessage: ${row.what}`, () => {
    assert.deepEqual(readHelpMessage(row.message, row.offered ?? ALL), row.expected);
  });
}

test('an own __proto__ member from JSON is data: the own type and language win', () => {
  const message: unknown = JSON.parse('{"__proto__":{"type":"zoom","delta":1},"type":"language","language":"ru"}');

  assert.deepEqual(readHelpMessage(message, ALL), language('ru'));
});

test('readHelpMessage never throws, whatever it is handed', () => {
  for (const row of TABLE) {
    assert.doesNotThrow(() => readHelpMessage(row.message, ALL), row.what);
  }
  assert.doesNotThrow(() => readHelpMessage(Object.create(null), ALL));
  assert.doesNotThrow(() => readHelpMessage(Symbol('language'), ALL));
  assert.doesNotThrow(() => readHelpMessage(() => undefined, ALL));
  assert.doesNotThrow(() => readHelpMessage({ type: 'language', language: 'ru' }, []));
});

/**
 * The contract has two sides — the page POSTS, the host READS — and a test on each alone compares each
 * list to itself (`common.testing`). This runs the kit's own help page script and feeds what it posted
 * into the reader: the one live check between the two.
 */
test('what the kit\'s own help page posts — a language, a size, a tone — is exactly what the reader accepts', () => {
  const unstamped = createCatalog({
    articles: PAGE.articles,
    translations: Object.fromEntries(TRANSLATED_LANGUAGES.map((code) => [code, { bodies: PAGE.translations[code], from: {} }])),
  });
  const catalog = createCatalog({ articles: PAGE.articles, translations: stampTranslations(unstamped) });
  const html = renderHelpPage({ catalog, language: 'en', display: createDisplayConfig('ConnectOtherAIs', 'coai'), nonce: 'b2JQb3ZlcnR5X3JhbmRvbQ' });
  const script = /<script nonce="[^"]*">([\s\S]*)<\/script>/.exec(html)?.[1] ?? '';
  const select = new Node({}, 'SELECT');
  const larger = new Node({ zoom: '1' }, 'BUTTON');
  const dimmer = new Node({ tone: '-1' }, 'BUTTON');
  const page = runPageScript(
    script,
    { 'button[data-zoom]': [larger], 'button[data-tone]': [dimmer] },
    {
      language: select, index: new Node({}, 'UL'), article: new Node(), crumbs: new Node(), back: new Node({}, 'BUTTON'),
      searchRow: new Node(), noHits: new Node({}, 'P'), search: new Node({}, 'INPUT'), zoomOffset: new Node({}, 'SPAN'), toneOffset: new Node({}, 'SPAN'),
    },
  );

  select.value = 'es';
  select.fire('change');
  larger.click();
  dimmer.click();

  assert.deepEqual(page.posted.map((message) => readHelpMessage(message, catalog.languages)), [language('es'), press('zoom', 1), press('tone', -1)]);
});
