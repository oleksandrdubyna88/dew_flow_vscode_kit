import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { SettingName } from '../display/port';
import { FakeConfiguration, FakeWebview, settingKey } from './fakeDisplayPorts';

/**
 * The fakes are code under test (`common.generated-code-tests` § 3): a permissive fake turns the host's
 * suite green for the wrong reason. Each test here pins one promise the host tests lean on.
 */

const SCALE: SettingName = { section: 'kit', key: 'uiScale' };
const TONE: SettingName = { section: 'kit', key: 'textTone' };
const STRANGER: SettingName = { section: 'kit', key: 'helpLanguage' };

test('a setting the test never declared cannot be read, written or watched — refused by name', () => {
  const configuration = new FakeConfiguration([SCALE]);

  assert.throws(() => configuration.read(STRANGER), /read kit\.helpLanguage, which this test never declared; known: kit\.uiScale/);
  assert.throws(() => configuration.write(STRANGER, 1), /write kit\.helpLanguage/);
  assert.throws(() => configuration.onDidChange(STRANGER, () => undefined), /watch kit\.helpLanguage/);
  assert.throws(() => configuration.change(STRANGER, 1), /change kit\.helpLanguage/);
});

test('a write is recorded, stored for the next read, and told to the listeners of THAT setting only', async () => {
  const configuration = new FakeConfiguration([SCALE, TONE], { 'kit.uiScale': 2 });
  const told: string[] = [];
  configuration.onDidChange(SCALE, () => { told.push('scale'); });
  configuration.onDidChange(TONE, () => { told.push('tone'); });

  assert.equal(configuration.read(SCALE), 2);
  assert.equal(configuration.read(TONE), undefined, 'a known setting with no value reads undefined, as the real API answers without a default');
  await configuration.write(SCALE, 3);

  assert.deepEqual(configuration.writes, [{ setting: 'kit.uiScale', value: 3 }]);
  assert.equal(configuration.read(SCALE), 3);
  assert.deepEqual(told, ['scale']);
});

test('a disposed listener is not told again, and disposing it twice is harmless', () => {
  const configuration = new FakeConfiguration([SCALE]);
  let told = 0;
  const hook = configuration.onDidChange(SCALE, () => { told += 1; });

  configuration.change(SCALE, 1);
  hook.dispose();
  hook.dispose();
  configuration.change(SCALE, 2);

  assert.equal(told, 1);
  assert.equal(configuration.liveListeners(), 0);
});

test('held writes stay pending until released, then apply in order — and a write after release lands at once', async () => {
  const configuration = new FakeConfiguration([SCALE]);
  configuration.hold();
  let firstDone = false;
  const first = configuration.write(SCALE, 1).then(() => { firstDone = true; });
  const second = configuration.write(SCALE, 2);
  await Promise.resolve();
  assert.equal(firstDone, false, 'a held write resolved on its own');
  assert.equal(configuration.writes.length, 0);

  configuration.release();
  await Promise.all([first, second]);
  await configuration.write(SCALE, 3);

  assert.deepEqual(configuration.writes.map((w) => w.value), [1, 2, 3]);
  assert.equal(configuration.read(SCALE), 3);
});

test('a hold on ONE setting leaves the other setting\'s writes going through', async () => {
  const configuration = new FakeConfiguration([SCALE, TONE]);
  configuration.hold(TONE);

  let toneDone = false;
  const tone = configuration.write(TONE, -1).then(() => { toneDone = true; });
  await configuration.write(SCALE, 1);
  assert.equal(toneDone, false, 'the held setting\'s write resolved on its own');
  assert.deepEqual(configuration.writes, [{ setting: 'kit.uiScale', value: 1 }]);

  configuration.release();
  await tone;
  assert.deepEqual(configuration.writes.map((w) => w.setting), ['kit.uiScale', 'kit.textTone']);
});

test('a failed write rejects with the reason the test gave — undefined included — and is not applied', async () => {
  const configuration = new FakeConfiguration([SCALE], { 'kit.uiScale': 4 });
  configuration.failNextWrite(new Error('read-only settings file'));
  await assert.rejects(configuration.write(SCALE, 5), /read-only settings file/);

  configuration.failNextWrite(undefined);
  await assert.rejects(configuration.write(SCALE, 5), (reason: unknown) => reason === undefined);

  assert.equal(configuration.writes.length, 0);
  assert.equal(configuration.read(SCALE), 4);
  await configuration.write(SCALE, 6);
  assert.equal(configuration.read(SCALE), 6, 'only the NEXT write fails');
});

test('a failed watch throws the reason the test gave, for that setting only, hooks nothing, and only once', () => {
  const configuration = new FakeConfiguration([SCALE, TONE]);
  const refused = new Error('the registration was refused');
  configuration.failNextWatch(TONE, refused);
  let told = 0;

  configuration.onDidChange(SCALE, () => { told += 1; });
  assert.throws(() => configuration.onDidChange(TONE, () => { told += 100; }), (reason: unknown) => reason === refused);
  assert.equal(configuration.liveListeners(TONE), 0, 'a refused watch hooked a listener');
  assert.equal(configuration.liveListeners(SCALE), 1, 'the other setting was refused too');

  configuration.onDidChange(TONE, () => { told += 10; });
  configuration.change(TONE, 1);
  configuration.change(SCALE, 1);
  assert.equal(told, 11, 'only the NEXT watch fails, and the refused listener is never told');
  assert.throws(() => configuration.failNextWatch(STRANGER, refused), /fail a watch of kit\.helpLanguage/);
});

test('an outside change is stored and told, and counts no write', () => {
  const configuration = new FakeConfiguration([SCALE]);
  let seen: unknown = 'untouched';
  configuration.onDidChange(SCALE, () => { seen = configuration.read(SCALE); });

  configuration.change(SCALE, 'junk from a hand-edited file');

  assert.equal(seen, 'junk from a hand-edited file');
  assert.equal(configuration.writes.length, 0);
});

test('settingKey spells a setting as VS Code does', () => {
  assert.equal(settingKey({ section: 'coai', key: 'uiScale' }), 'coai.uiScale');
});

test('a delivered post is cloned into posted[] and resolves true; refused resolves false; rejects rejects; hangs never settles', async () => {
  const message = { type: 'uiScale' as const, px: 14.3, label: '+1' };
  const delivered = new FakeWebview('delivered');
  const refused = new FakeWebview('refused', 'refused');
  const rejecting = new FakeWebview('rejecting', 'rejects');
  const hanging = new FakeWebview('hanging', 'hangs');

  assert.equal(await delivered.postMessage(message), true);
  assert.equal(await refused.postMessage(message), false);
  await assert.rejects(rejecting.postMessage(message), /webview rejecting refused the message/);
  let settled = false;
  void hanging.postMessage(message).then(() => { settled = true; }, () => { settled = true; });
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(settled, false, 'a hanging post settled');

  for (const webview of [delivered, refused, rejecting, hanging]) {
    assert.deepEqual(webview.posted, [message], `${webview.name} did not record the post`);
    assert.notEqual(webview.posted[0], message, 'posted[] must hold a clone, as a real postMessage sends one');
  }
});

test('a post to a disposed webview throws AND is counted, so a host that swallows the throw is still caught', () => {
  const webview = new FakeWebview('closed');
  webview.dispose();

  assert.throws(() => webview.postMessage({ type: 'textTone', color: '', read: '', label: '' }), /Webview closed is disposed/);
  assert.equal(webview.postedAfterDispose, 1);
  assert.deepEqual(webview.posted, []);
});

test('dispose tells every listener once, unhooks them all, and refuses a second dispose or a late listener', () => {
  const webview = new FakeWebview('panel');
  const told: string[] = [];
  const hook = webview.onDidDispose(() => { told.push('a'); });
  webview.onDidDispose(() => { told.push('b'); });
  hook.dispose();
  assert.equal(webview.liveDisposeListeners(), 1);

  webview.dispose();

  assert.deepEqual(told, ['b']);
  assert.equal(webview.liveDisposeListeners(), 0);
  assert.throws(() => webview.dispose(), /disposed twice/);
  assert.throws(() => webview.onDidDispose(() => undefined), /after it was disposed/);
});
