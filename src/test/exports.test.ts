import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { test } from 'node:test';

import * as kit from '../index';

/**
 * The package's public surface is a contract two extensions bundle against, so it is pinned here as a
 * list: a name added or dropped by accident — a helper that leaked, a function somebody forgot to
 * re-export — is a red test, not a surprise in a consumer's build. Values are read from the compiled
 * entry; types, which the compiler erases, are read from `src/index.ts`'s own export lists.
 */

const VALUES: readonly string[] = [
  // display — configuration, the two pure halves, the pushed messages, the press reader, the host
  'createDisplayConfig', 'isUsablePrefix', 'usablePrefix',
  'UI_SCALE_MAX', 'UI_SCALE_MIN', 'ZOOM_CSS', 'clampScale', 'offsetLabel', 'scalePx', 'zoomControlHtml', 'zoomScript', 'zoomStyle',
  'TEXT_TONE_MAX', 'TEXT_TONE_MIN', 'clampTone', 'toneColour', 'toneColours', 'toneControlHtml', 'toneCss', 'toneLabel', 'toneScript', 'toneStyle',
  'textToneMessage', 'uiScaleMessage',
  'readPress',
  'createDisplayHost',
  // settings
  'settingWritten',
  // text
  'asText',
  // webview
  'escapeHtml', 'escapeHtmlForHighlighting', 'jsonForScript', 'nonce', 'WriteQueue',
  // help — the catalog, its digest, the bootstrap, the coverage checks
  'HELP_BODY_FIELDS', 'HELP_LANGUAGE_LABELS', 'HELP_LANGUAGES', 'TRANSLATED_LANGUAGES',
  'bodyFor', 'createCatalog', 'canonicalForm', 'digestOf', 'isDigest', 'stampTranslations', 'everyArticleInEveryLanguage', 'staleTranslations',
  // help — the page, its message reader, the panel
  'renderHelpPage', 'searchIndex', 'articleHtml', 'bodyHtml', 'helpCsp', 'readHelpMessage', 'createHelpPanel',
];

const TYPES: readonly string[] = [
  'DisplayConfig',
  'ConfigurationPort', 'Disposable', 'DisplayMessage', 'SettingName', 'TextToneMessage', 'UiScaleMessage', 'WebviewPort',
  'Press', 'PressKind', 'PressReading', 'PressRejection', 'Step',
  'DisplayHost', 'DisplayHostOptions', 'DisplayReporter', 'DisplaySettings', 'DisplayValues', 'PushNotDelivered',
  'SettingNotSaved', 'SettingReporter',
  'ArticleId', 'Catalog', 'Digest', 'HelpArticle', 'HelpBody', 'HelpLanguage', 'ShownBody', 'Staleness', 'TranslatedLanguage', 'Translation', 'Translations',
  'CatalogInput', 'Coverage', 'MissingTranslation', 'StaleTranslation',
  'HelpPageOptions', 'HelpAppendix', 'SearchEntry',
  'HelpAction', 'HelpMessageReading', 'HelpMessageRejection',
  'HelpPanel', 'HelpPanelOptions', 'HelpPanelPort',
];

/** Names that exist in the kit and must NOT be public — the test that a widening of the index did not leak one. */
const INTERNAL: readonly string[] = [
  'Host', 'Panel', 'sha256Hex', 'HELP_CHROME', 'SECTION_LABELS', 'SECTION_ORDER', 'noteHtml', 'helpScript', 'translatedEntry', 'translatedLanguages',
  'postedRecord', 'ownMember', 'isEmptyField', 'fieldNotText', 'DIGEST_LENGTH',
];

const sorted = (names: readonly string[]): string[] => [...names].sort();

test('the package exports exactly the 0.1.0 values — a name added or dropped by accident is red', () => {
  assert.deepEqual(sorted(Object.keys(kit)), sorted(VALUES));
});

test('every exported value is a function, a class, a frozen-shaped constant or a string — and nothing internal is among them', () => {
  for (const name of VALUES) {
    const value = (kit as Record<string, unknown>)[name];
    assert.ok(value !== undefined, `${name} is exported as undefined`);
    assert.ok(['function', 'object', 'string', 'number'].includes(typeof value), `${name} is a ${typeof value}`);
  }
  for (const name of INTERNAL) {
    assert.equal(name in kit, false, `${name} is internal and leaked into the public surface`);
  }
});

test('the exported type names, read from src/index.ts, are exactly the 0.1.0 types', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '..', '..', 'src', 'index.ts'), 'utf8');
  const lists = [...source.matchAll(/export\s+(type\s+)?\{([^}]*)\}\s+from/g)];
  assert.ok(lists.length > 0, 'no export lists found in src/index.ts');
  const types = lists.flatMap(([, typeOnly, body]) =>
    (body ?? '')
      .split(',')
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0)
      .flatMap((entry) => {
        const named = /^type\s+(\w+)$/.exec(entry);
        if (named !== null) {
          return [named[1] ?? ''];
        }

        return typeOnly === undefined ? [] : [entry];
      }),
  );

  assert.deepEqual(sorted(types), sorted(TYPES));
});

test('the lists are what the index spells: every export list in src/index.ts is one of the two, and nothing is listed twice', () => {
  assert.equal(new Set(VALUES).size, VALUES.length, 'a value is listed twice');
  assert.equal(new Set(TYPES).size, TYPES.length, 'a type is listed twice');
  assert.equal(VALUES.filter((name) => TYPES.includes(name)).length, 0, 'a name is both a value and a type');
});
