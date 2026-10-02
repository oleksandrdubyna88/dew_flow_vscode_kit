import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createDisplayConfig } from '../display/config';
import { createDisplayHost, type DisplaySettings, type PushNotDelivered } from '../display/host';
import { uiScaleMessage } from '../display/messages';
import type { SettingName } from '../display/port';
import { scalePx } from '../display/zoom';
import { stampTranslations } from '../help/bootstrap';
import { createCatalog } from '../help/catalog';
import { articleHtml, renderHelpPage, type HelpAppendix } from '../help/page';
import { createHelpPanel } from '../help/panel';
import { TRANSLATED_LANGUAGES, type Catalog } from '../help/types';
import type { SettingNotSaved } from '../settings/settingWritten';
import { jsonForScript } from '../webview/escape';
import { RECORDED_HELP_PAGE as PAGE } from './coaiFixture';
import { FakeConfiguration, FakeWebview, settingKey } from './fakeDisplayPorts';
import { FakeHelpPanelPort } from './fakeHelpPanelPort';

/**
 * The help panel's host half, against the strict fakes and the REAL display host: it renders the page on
 * open and again on a language change, writes a language the page chose through the write queue, routes
 * a ± press to the display host (which pushes the new value back to this very page), refuses what the
 * page should not have sent, reports a failed write once, and unhooks everything on dispose — its own
 * hooks only, never the consumer's display host.
 */

const COAI = createDisplayConfig('ConnectOtherAIs', 'coai');
const LANGUAGE: SettingName = { section: 'coai', key: 'helpLanguage' };
const SETTINGS: DisplaySettings = { uiScale: { section: 'coai', key: 'uiScale' }, textTone: { section: 'coai', key: 'textTone' } };
const appendix: HelpAppendix = (id, language) => (id === PAGE.promptsArticle ? PAGE.appendix[language] : '');
const NONCE_IN_CSP = /'nonce-([A-Za-z0-9_-]{22})'/;
const NONCE_ON_SCRIPT = /<script nonce="([A-Za-z0-9_-]{22})">/;

/** The recorded synthetic input as a fresh kit catalog — all four modules, so every language is offered. */
function fullCatalog(): Catalog {
  const unstamped = createCatalog({
    articles: PAGE.articles,
    translations: Object.fromEntries(TRANSLATED_LANGUAGES.map((language) => [language, { bodies: PAGE.translations[language], from: {} }])),
  });

  return createCatalog({ articles: PAGE.articles, translations: stampTranslations(unstamped) });
}

/** A catalog that offers English and Russian only. */
function ruOnly(): Catalog {
  const full = fullCatalog();

  return createCatalog({ articles: full.articles, translations: { ru: full.translations.ru ?? { bodies: {}, from: {} } } });
}

/** A panel over fresh fakes and a real display host. `stored` is keyed `section.key`. */
function rig(stored: Readonly<Record<string, unknown>> = {}, catalog: Catalog = fullCatalog()) {
  const configuration = new FakeConfiguration([LANGUAGE, SETTINGS.uiScale, SETTINGS.textTone], stored);
  const notSaved: SettingNotSaved[] = [];
  const notDelivered: PushNotDelivered[] = [];
  const display = createDisplayHost({
    config: COAI,
    settings: SETTINGS,
    configuration,
    reporter: { settingNotSaved: async (notice) => { notSaved.push(notice); }, pushNotDelivered: (notice) => { notDelivered.push(notice); } },
  });
  const panel = new FakeHelpPanelPort('help');
  const help = createHelpPanel({ catalog, display, languageSetting: LANGUAGE, configuration, panel, settingNotSaved: async (notice) => { notSaved.push(notice); }, appendix });

  return { configuration, display, panel, help, notSaved, notDelivered };
}

/** The nonce a rendered page carries — in its CSP and on its script, which must agree. */
function nonceOf(html: string): string {
  const inCsp = NONCE_IN_CSP.exec(html)?.[1];
  const onScript = NONCE_ON_SCRIPT.exec(html)?.[1];
  assert.ok(inCsp !== undefined && inCsp === onScript, 'the CSP nonce and the script nonce must be one nonce');

  return inCsp;
}

const stored = (language: unknown, uiScale = 0, textTone = 0): Record<string, unknown> => ({
  [settingKey(LANGUAGE)]: language,
  [settingKey(SETTINGS.uiScale)]: uiScale,
  [settingKey(SETTINGS.textTone)]: textTone,
});

const settle = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

// ---------------------------------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------------------------------

test('opening renders the page once, in the stored language, at the current size and tone, under a fresh nonce the CSP and the script share', () => {
  const { panel } = rig(stored('ru', 2, -1));

  assert.equal(panel.rendered.length, 1);
  assert.ok(panel.html.includes('<option value="ru" selected>'));
  assert.ok(panel.html.includes(`font-size: ${scalePx(2)}px;`));
  assert.ok(panel.html.includes('--coai-text: color-mix('));
  nonceOf(panel.html);
});

test('the page the panel renders IS renderHelpPage\'s page for the same inputs — appendix included', () => {
  const { panel } = rig(stored('es', 1, 1));
  const nonce = nonceOf(panel.html);

  assert.equal(panel.html, renderHelpPage({ catalog: fullCatalog(), language: 'es', display: COAI, nonce, uiScale: 1, textTone: 1, appendix }));
  // The article markup reaches the page inside the script's ARTICLES, through jsonForScript.
  assert.ok(panel.html.includes(jsonForScript(articleHtml(fullCatalog(), PAGE.promptsArticle, 'es', appendix))));
});

test('the page has its HTML before the display host pushes to it, and a page that cannot render leaves nothing hooked', () => {
  const configuration = new FakeConfiguration([LANGUAGE, SETTINGS.uiScale, SETTINGS.textTone], stored('en', 3));
  const display = createDisplayHost({
    config: COAI, settings: SETTINGS, configuration,
    reporter: { settingNotSaved: async () => undefined, pushNotDelivered: () => undefined },
  });
  const order: string[] = [];
  const panel = new FakeHelpPanelPort('help');
  const setHtml = panel.setHtml.bind(panel);
  panel.setHtml = (html) => { order.push('html'); setHtml(html); };
  const postMessage = panel.postMessage.bind(panel);
  panel.postMessage = (message) => { order.push(message.type); return postMessage(message); };
  const options = { catalog: fullCatalog(), display, languageSetting: LANGUAGE, configuration, panel, settingNotSaved: async () => undefined };

  createHelpPanel(options);
  assert.deepEqual(order, ['html', 'uiScale', 'textTone']);

  const broken = new FakeHelpPanelPort('broken');
  const throwing: HelpAppendix = () => { throw new Error('the consumer\'s appendix broke'); };
  assert.throws(() => createHelpPanel({ ...options, panel: broken, appendix: throwing }), /appendix broke/);
  assert.equal(broken.liveMessageListeners(), 0);
  assert.equal(broken.liveDisposeListeners(), 0);
  assert.equal(configuration.liveListeners(LANGUAGE), 1, 'only the first panel\'s language listener');
  assert.equal(broken.posted.length, 0);
});

test('every render mints a new nonce', () => {
  const { panel, help } = rig();

  help.render();
  help.render();

  const nonces = panel.rendered.map(nonceOf);
  assert.equal(new Set(nonces).size, 3, `three renders, three nonces; got ${nonces.join(', ')}`);
});

test('a stored language that is junk, not a string, absent, or one this catalog does not offer reads as English — never a throw', () => {
  assert.equal(rig(stored('xx')).help.language(), 'en');
  assert.equal(rig(stored(42)).help.language(), 'en');
  assert.equal(rig().help.language(), 'en');
  assert.equal(rig(stored('constructor')).help.language(), 'en');
  const partial = rig(stored('de'), ruOnly());
  assert.equal(partial.help.language(), 'en', 'German is a help language, but this catalog has no German module');
  assert.ok(partial.panel.html.includes('<option value="en" selected>'));
});

test('a change of the language setting from outside — the Settings UI, sync — re-renders in the new language', () => {
  const { configuration, panel } = rig(stored('en'));

  configuration.change(LANGUAGE, 'uk');

  assert.equal(panel.rendered.length, 2);
  assert.ok(panel.html.includes('<option value="uk" selected>'));
});

// ---------------------------------------------------------------------------------------------------
// Messages from the page
// ---------------------------------------------------------------------------------------------------

test('a language the page chose is written once, and the change re-renders the page in it', async () => {
  const { configuration, panel, help } = rig(stored('en'));

  const reading = await help.handle({ type: 'language', language: 'de', field: '' });

  assert.deepEqual(reading, { accepted: true, action: { kind: 'language', language: 'de' } });
  assert.deepEqual(configuration.writes, [{ setting: settingKey(LANGUAGE), value: 'de' }]);
  assert.equal(panel.rendered.length, 2);
  assert.ok(panel.html.includes('<option value="de" selected>'));
});

test('a message arriving through the port\'s own listener is handled the same way', async () => {
  const { configuration, panel } = rig(stored('en'));

  panel.receive({ type: 'language', language: 'uk', field: '' });
  await settle();

  assert.deepEqual(configuration.writes, [{ setting: settingKey(LANGUAGE), value: 'uk' }]);
  assert.ok(panel.html.includes('<option value="uk" selected>'));
});

test('two quick language choices both land, in order, through the write queue', async () => {
  const { configuration, panel, help } = rig(stored('en'));
  configuration.hold(LANGUAGE);

  const first = help.handle({ type: 'language', language: 'ru' });
  const second = help.handle({ type: 'language', language: 'es' });
  configuration.release();
  await Promise.all([first, second]);

  assert.deepEqual(configuration.writes.map((w) => w.value), ['ru', 'es']);
  assert.ok(panel.html.includes('<option value="es" selected>'));
});

test('a language this catalog does not offer is NOT written, even though the help knows it', async () => {
  const { configuration, panel, help } = rig(stored('en'), ruOnly());

  const reading = await help.handle({ type: 'language', language: 'de', field: '' });

  assert.deepEqual(reading, { accepted: false, reason: 'language-not-offered' });
  assert.equal(configuration.writes.length, 0);
  assert.equal(panel.rendered.length, 1);
});

test('a language the help does not have, an unknown type, and hostile shapes write nothing, re-render nothing, and throw nothing', async () => {
  const { configuration, panel, help } = rig(stored('en'));
  const hostile: unknown[] = [
    { type: 'language', language: 'fr' },
    { type: 'language', language: '__proto__' },
    { type: 'language', language: ['ru'] },
    { type: 'language', language: 'ru', field: 'x' },
    { type: 'open', id: 'alpha' },
    { type: 'zoom', delta: '1' },
    Object.create({ type: 'language', language: 'ru' }) as unknown,
    null,
    'language',
    ['language', 'ru'],
    42,
    {},
  ];

  for (const message of hostile) {
    const reading = await help.handle(message);
    assert.equal(reading.accepted, false, JSON.stringify(message));
  }

  assert.equal(configuration.writes.length, 0);
  assert.equal(panel.rendered.length, 1);
});

test('a ± press from the help page goes through the display host: one clamped write, and this page is pushed the new value', async () => {
  const { configuration, panel, help } = rig(stored('en', 4, 0));
  const before = panel.posted.length;

  const reading = await help.handle({ type: 'zoom', delta: 1, field: '' });
  await help.handle({ type: 'zoom', delta: 1, field: '' });

  assert.deepEqual(reading, { accepted: true, action: { kind: 'press', press: { kind: 'zoom', step: 1 } } });
  assert.deepEqual(configuration.writes, [{ setting: settingKey(SETTINGS.uiScale), value: 5 }, { setting: settingKey(SETTINGS.uiScale), value: 5 }]);
  assert.deepEqual(panel.posted.slice(before), [uiScaleMessage(5), uiScaleMessage(5)]);
  assert.equal(panel.rendered.length, 1, 'a size change is pushed live, never a re-render that would lose the reader\'s place');
});

test('a failed language write is reported once through settingNotSaved, naming help; the panel keeps working', async () => {
  const { configuration, help, notSaved } = rig(stored('en'));
  configuration.failNextWrite(new Error('read-only settings file'));

  const reading = await help.handle({ type: 'language', language: 'ru' });

  assert.equal(reading.accepted, true, 'a valid choice that could not be saved is still a valid choice');
  assert.deepEqual(notSaved, [{
    source: 'help',
    code: 'view-setting-not-saved',
    title: 'That view setting could not be saved: Error: read-only settings file',
    detail: 'Error: read-only settings file',
  }]);
  assert.equal(configuration.writes.length, 0);

  await help.handle({ type: 'language', language: 'ru' });
  assert.deepEqual(configuration.writes.map((w) => w.value), ['ru']);
  assert.equal(notSaved.length, 1);
});

// ---------------------------------------------------------------------------------------------------
// Lifetimes
// ---------------------------------------------------------------------------------------------------

test('dispose unhooks every hook of its own — language listener, message listener, display attachment, dispose listener — and nothing of the consumer\'s display host', () => {
  const { configuration, display, panel, help } = rig(stored('en'));
  assert.equal(configuration.liveListeners(LANGUAGE), 1);
  assert.equal(configuration.liveListeners(), 3, 'the panel\'s language listener and the display host\'s two');
  assert.equal(panel.liveMessageListeners(), 1);
  assert.equal(panel.liveDisposeListeners(), 2, 'the panel\'s own and the display attachment\'s');
  const pushed = panel.posted.length;

  help.dispose();
  help.dispose();

  assert.equal(configuration.liveListeners(LANGUAGE), 0);
  assert.equal(panel.liveMessageListeners(), 0);
  assert.equal(panel.liveDisposeListeners(), 0);
  assert.equal(configuration.liveListeners(), 2, 'the display host is the consumer\'s and must survive the help panel');
  configuration.change(LANGUAGE, 'uk');
  configuration.change(SETTINGS.uiScale, 3);
  assert.equal(panel.rendered.length, 1, 'a disposed panel re-rendered');
  assert.equal(panel.posted.length, pushed, 'a disposed panel was pushed a change');
  assert.throws(() => help.render(), /disposed/);
  assert.throws(() => help.handle({ type: 'language', language: 'ru' }), /disposed/);
  const other = new FakeWebview('other');
  display.attach(other);
  configuration.change(SETTINGS.uiScale, 4);
  assert.deepEqual(other.posted.at(-1), uiScaleMessage(4), 'the display host must still serve other pages');
});

test('closing the panel — its own dispose event — unhooks the same, so a closed page holds nothing', () => {
  const { configuration, panel } = rig(stored('en'));

  panel.dispose();

  assert.equal(configuration.liveListeners(LANGUAGE), 0);
  assert.equal(panel.liveMessageListeners(), 0);
  assert.equal(panel.liveDisposeListeners(), 0);
  assert.equal(configuration.liveListeners(), 2);
  configuration.change(LANGUAGE, 'uk');
  assert.equal(panel.rendered.length, 1);
  assert.equal(panel.postedAfterDispose, 0);
});

test('a pending language write still lands after dispose, as a pending display write does', async () => {
  const { configuration, help } = rig(stored('en'));
  configuration.hold(LANGUAGE);
  const writing = help.handle({ type: 'language', language: 'ru' });

  help.dispose();
  configuration.release();
  await writing;

  assert.deepEqual(configuration.writes.map((w) => w.value), ['ru']);
});

/** The three registrations a panel makes AFTER its display attachment, each made to throw in turn. */
const LATER_REGISTRATIONS: readonly { what: string; break: (configuration: FakeConfiguration, panel: FakeHelpPanelPort, refused: Error) => void }[] = [
  { what: 'language listener', break: (configuration, _panel, refused) => { configuration.failNextWatch(LANGUAGE, refused); } },
  { what: 'message listener', break: (_configuration, panel, refused) => { panel.onDidReceiveMessage = () => { throw refused; }; } },
  {
    what: 'own dispose listener',
    break: (_configuration, panel, refused) => {
      // The display attachment hooks the panel's dispose event first; the panel's own hook is the second.
      const hook = panel.onDidDispose.bind(panel);
      let calls = 0;
      panel.onDidDispose = (listener) => {
        calls += 1;
        if (calls === 2) {
          throw refused;
        }
        return hook(listener);
      };
    },
  },
];

for (const registration of LATER_REGISTRATIONS) {
  test(`a panel whose ${registration.what} cannot be registered rethrows and leaves nothing hooked: the display attachment is detached`, () => {
    const configuration = new FakeConfiguration([LANGUAGE, SETTINGS.uiScale, SETTINGS.textTone], stored('en'));
    const display = createDisplayHost({
      config: COAI, settings: SETTINGS, configuration,
      reporter: { settingNotSaved: async () => undefined, pushNotDelivered: () => undefined },
    });
    const panel = new FakeHelpPanelPort('help');
    const refused = new Error(`${registration.what} was refused`);
    registration.break(configuration, panel, refused);

    assert.throws(
      () => createHelpPanel({ catalog: fullCatalog(), display, languageSetting: LANGUAGE, configuration, panel, settingNotSaved: async () => undefined }),
      (reason: unknown) => reason === refused,
    );
    assert.equal(panel.liveDisposeListeners(), 0, 'a dispose listener — the display attachment\'s or the panel\'s — outlived a panel that was never made');
    assert.equal(panel.liveMessageListeners(), 0, 'the message listener outlived a panel that was never made');
    assert.equal(configuration.liveListeners(LANGUAGE), 0, 'the language listener outlived a panel that was never made');
    assert.equal(configuration.liveListeners(), 2, 'the display host is the consumer\'s and must survive');
    const pushed = panel.posted.length;
    configuration.change(SETTINGS.uiScale, 3);
    assert.equal(panel.posted.length, pushed, 'the display host still pushes to a panel that was never made');
  });
}
