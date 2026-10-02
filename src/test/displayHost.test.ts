import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createDisplayConfig } from '../display/config';
import { createDisplayHost, type DisplayReporter, type DisplaySettings, type PushNotDelivered } from '../display/host';
import { textToneMessage, uiScaleMessage } from '../display/messages';
import type { WebviewPort } from '../display/port';
import type { Press } from '../display/press';
import { clampTone } from '../display/tone';
import { clampScale } from '../display/zoom';
import type { SettingNotSaved } from '../settings/settingWritten';
import { RECORDED, RECORDED_OFFSETS } from './coaiFixture';
import { FakeConfiguration, FakeWebview, settingKey } from './fakeDisplayPorts';

/**
 * The host half of the two text controls, against the strict fakes: a press is clamped and written once
 * through the write queue, every ATTACHED page is pushed the new value, a page that is gone is let go,
 * and `dispose()` leaves nothing hooked. The values a press writes and the messages a change pushes are
 * held against what ConnectOtherAIs' own hosts did at `1056aed9` (`RECORDED.host`).
 */

const CONFIG = createDisplayConfig('ConnectOtherAIs', 'coai');
const SETTINGS: DisplaySettings = {
  uiScale: { section: RECORDED.host.section, key: RECORDED.host.keys.uiScale },
  textTone: { section: RECORDED.host.section, key: RECORDED.host.keys.textTone },
};
const ZOOM_UP: Press = { kind: 'zoom', step: 1 };
const TONE_DOWN: Press = { kind: 'tone', step: -1 };
/** A reporter for a test that asserts neither funnel. */
const QUIET: DisplayReporter = { settingNotSaved: async () => undefined, pushNotDelivered: () => undefined };

/** A host over fresh fakes, with both reporters recording. `stored` is keyed `section.key`. */
function rig(stored: Readonly<Record<string, unknown>> = {}) {
  const configuration = new FakeConfiguration([SETTINGS.uiScale, SETTINGS.textTone], stored);
  const notSaved: SettingNotSaved[] = [];
  const notDelivered: PushNotDelivered[] = [];
  const host = createDisplayHost({
    config: CONFIG,
    settings: SETTINGS,
    configuration,
    reporter: {
      settingNotSaved: async (notice) => { notSaved.push(notice); },
      pushNotDelivered: (notice) => { notDelivered.push(notice); },
    },
  });

  return { configuration, host, notSaved, notDelivered };
}

/** Both settings stored at one offset. */
function bothAt(offset: unknown): Record<string, unknown> {
  return { [settingKey(SETTINGS.uiScale)]: offset, [settingKey(SETTINGS.textTone)]: offset };
}

test('the recording is coai\'s own hosts, for the offsets and presses the tests walk', () => {
  assert.match(RECORDED.source, /1056aed9/);
  assert.match(RECORDED.source, /uiScaleHost,textToneHost/);
  assert.deepEqual(Object.keys(RECORDED.host.uiScale).map(Number).sort((a, b) => a - b), [...RECORDED_OFFSETS]);
  assert.deepEqual(Object.keys(RECORDED.host.textTone).map(Number).sort((a, b) => a - b), [...RECORDED_OFFSETS]);
  assert.ok(RECORDED.host.writes.length >= 10);
  // The port contract says "user (global) scope"; this is the recording that says coai did exactly that.
  assert.ok(RECORDED.host.writes.every((write) => write.scope === 'Global'), 'coai wrote somewhere other than the global scope');
});

// ---------------------------------------------------------------------------------------------------
// Reading the settings
// ---------------------------------------------------------------------------------------------------

test('current() clamps a junk or out-of-range stored value exactly as coai clamped it', () => {
  const inputs: readonly unknown[] = [null, 'x', 2.9, -2.9, Infinity, Number.NaN];

  for (const [index, input] of inputs.entries()) {
    const { host } = rig(bothAt(input));

    assert.equal(host.current().uiScale, RECORDED.clamp.scale[index], `uiScale for ${String(input)}`);
    assert.equal(host.current().textTone, RECORDED.clamp.tone[index], `textTone for ${String(input)}`);
  }
  assert.deepEqual(rig(bothAt(9)).host.current(), { uiScale: 5, textTone: 5 });
  assert.deepEqual(rig().host.current(), { uiScale: 0, textTone: 0 }, 'nothing stored is the theme\'s own');
});

// ---------------------------------------------------------------------------------------------------
// A press → one clamped write
// ---------------------------------------------------------------------------------------------------

for (const write of RECORDED.host.writes.filter((w) => Math.trunc(w.delta) !== 0)) {
  test(`a press of ${write.delta} at ${JSON.stringify(write.current)} writes ${write.uiScale} / ${write.textTone} once, as coai did`, async () => {
    const { configuration, host } = rig(bothAt(write.current));

    const zoom = await host.press({ type: 'zoom', delta: write.delta }, 'chat');
    const tone = await host.press({ type: 'tone', delta: write.delta }, 'chat');

    assert.equal(zoom.accepted, true);
    assert.equal(tone.accepted, true);
    assert.deepEqual(configuration.writes, [
      { setting: settingKey(SETTINGS.uiScale), value: write.uiScale },
      { setting: settingKey(SETTINGS.textTone), value: write.textTone },
    ]);
  });
}

for (const write of RECORDED.host.writes.filter((w) => Math.trunc(w.delta) === 0)) {
  test(`a delta of ${write.delta} is refused before the host, so nothing is written (coai's applyZoomDelta alone wrote ${write.uiScale} back)`, async () => {
    // coai's unified parser (`textControlFrom`) refused these before they reached its host; only a page
    // bypassing that parser could make `applyZoomDelta` write the current value back. One rule here.
    const { configuration, host } = rig(bothAt(write.current));

    assert.deepEqual(await host.press({ type: 'zoom', delta: write.delta }, 'chat'), { accepted: false, reason: 'no-step' });
    assert.equal(configuration.writes.length, 0);
  });
}

test('press() answers the reading and writes nothing for a message that is not a press', async () => {
  const { configuration, host } = rig(bothAt(2));

  assert.deepEqual(await host.press({ type: 'zoom', delta: '1' }, 'chat'), { accepted: false, reason: 'delta-not-a-number' });
  assert.deepEqual(await host.press('zoom', 'chat'), { accepted: false, reason: 'not-an-object' });
  assert.equal(configuration.writes.length, 0);
});

test('two quick presses both land: the second reads what the first wrote', async () => {
  // Without the write queue both presses read 0 and both write 1 — the defect `WriteQueue.run` exists for.
  const { configuration, host } = rig(bothAt(0));
  configuration.hold();

  const first = host.apply(ZOOM_UP, 'chat');
  const second = host.apply(ZOOM_UP, 'chat');
  configuration.release();
  await Promise.all([first, second]);

  assert.deepEqual(configuration.writes.map((w) => w.value), [1, 2]);
  assert.equal(host.current().uiScale, 2);
});

test('the two settings queue independently: a held tone write does not delay a zoom write', { timeout: 2000 }, async () => {
  // One queue per setting, as coai had: a shared queue would make the zoom wait behind the tone here.
  const { configuration, host } = rig(bothAt(0));
  configuration.hold(SETTINGS.textTone);

  const heldTone = host.apply(TONE_DOWN, 'chat');
  await host.apply(ZOOM_UP, 'chat');
  assert.deepEqual(configuration.writes, [{ setting: settingKey(SETTINGS.uiScale), value: 1 }], 'the zoom write waited behind the held tone write');

  configuration.release();
  await heldTone;
  assert.deepEqual(configuration.writes.map((w) => `${w.setting}=${w.value}`), [
    `${settingKey(SETTINGS.uiScale)}=1`,
    `${settingKey(SETTINGS.textTone)}=-1`,
  ]);
});

test('a failed write is reported once through the consumer\'s reporter, naming the source, and the press still resolves', async () => {
  const { configuration, host, notSaved } = rig(bothAt(1));
  configuration.failNextWrite(new Error('read-only settings file'));

  const reading = await host.press({ type: 'zoom', delta: 1, field: '' }, 'help');

  assert.equal(reading.accepted, true, 'a valid press that could not be saved is still a valid press');
  assert.deepEqual(notSaved, [{
    source: 'help',
    code: 'view-setting-not-saved',
    title: 'That view setting could not be saved: Error: read-only settings file',
    detail: 'Error: read-only settings file',
  }]);
  assert.equal(configuration.writes.length, 0);

  await host.apply(ZOOM_UP, 'help');
  assert.deepEqual(configuration.writes.map((w) => w.value), [2], 'the write after a failed one must still run');
  assert.equal(notSaved.length, 1);
});

// ---------------------------------------------------------------------------------------------------
// Pushing to the pages
// ---------------------------------------------------------------------------------------------------

for (const offset of RECORDED_OFFSETS) {
  test(`the messages for a stored offset of ${offset} are byte-identical to what coai's hosts posted`, () => {
    const expectedScale = RECORDED.host.uiScale[String(offset)];
    const expectedTone = RECORDED.host.textTone[String(offset)];
    assert.ok(expectedScale !== undefined && expectedTone !== undefined);

    // The pure builders, then the host on attach — coai posted the size first, then the tone.
    assert.deepEqual(uiScaleMessage(clampScale(offset)), expectedScale);
    assert.deepEqual(textToneMessage(clampTone(offset), CONFIG), expectedTone);
    const { host } = rig(bothAt(offset));
    const page = new FakeWebview('page');
    host.attach(page);
    assert.deepEqual(page.posted, [expectedScale, expectedTone]);
  });
}

test('a change in one setting is pushed to every attached page — that setting\'s message, and only that one', () => {
  const { configuration, host } = rig(bothAt(0));
  const a = new FakeWebview('a');
  const b = new FakeWebview('b');
  host.attach(a);
  host.attach(b);

  configuration.change(SETTINGS.uiScale, 3);
  configuration.change(SETTINGS.textTone, -2);

  for (const page of [a, b]) {
    assert.deepEqual(page.posted.slice(2), [uiScaleMessage(3), textToneMessage(-2, CONFIG)], `${page.name} was not kept in step`);
  }
});

test('a press on one page reaches every page, through the setting', async () => {
  const { host } = rig(bothAt(0));
  const pressed = new FakeWebview('pressed');
  const other = new FakeWebview('other');
  host.attach(pressed);
  host.attach(other);

  await host.press({ type: 'tone', delta: 1, field: '' }, 'chat');

  assert.deepEqual(pressed.posted.at(-1), textToneMessage(1, CONFIG));
  assert.deepEqual(other.posted.at(-1), textToneMessage(1, CONFIG));
});

test('a page that was closed receives nothing more, and is not reported as a failure', () => {
  const { configuration, host, notDelivered } = rig(bothAt(0));
  const closed = new FakeWebview('closed');
  const open = new FakeWebview('open');
  host.attach(closed);
  host.attach(open);

  closed.dispose();
  configuration.change(SETTINGS.uiScale, 1);

  assert.equal(closed.postedAfterDispose, 0, 'the host posted to a closed page');
  assert.equal(closed.posted.length, 2, 'only the two attach-time messages');
  assert.equal(open.posted.length, 3);
  assert.deepEqual(notDelivered, [], 'a closed page is gone, not broken');
});

test('a page detached by the returned disposable receives nothing more, and its dispose listener is let go', () => {
  const { configuration, host } = rig(bothAt(0));
  const page = new FakeWebview('page');
  const hook = host.attach(page);
  assert.equal(page.liveDisposeListeners(), 1);

  hook.dispose();
  hook.dispose();
  configuration.change(SETTINGS.textTone, 2);

  assert.equal(page.posted.length, 2);
  assert.equal(page.liveDisposeListeners(), 0);
});

test('a page whose postMessage resolves false or rejects is reported and detached; the others still receive', async () => {
  const { configuration, host, notDelivered } = rig(bothAt(0));
  const good = new FakeWebview('good');
  const refusing = new FakeWebview('refusing');
  const rejecting = new FakeWebview('rejecting');
  for (const page of [good, refusing, rejecting]) {
    host.attach(page);
  }
  refusing.delivery = 'refused';
  rejecting.delivery = 'rejects';

  configuration.change(SETTINGS.uiScale, 2);
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(good.posted.at(-1), uiScaleMessage(2));
  assert.equal(refusing.posted.length, 3, 'the refusing page was posted to this once');
  assert.equal(rejecting.posted.length, 3);
  assert.deepEqual(
    notDelivered.map((n) => [n.code, n.message, n.detail]).sort(),
    [
      ['display-push-not-delivered', 'uiScale', 'Error: webview rejecting refused the message'],
      ['display-push-not-delivered', 'uiScale', 'postMessage resolved false'],
    ],
  );
  assert.equal(refusing.liveDisposeListeners(), 0, 'a detached page keeps a dispose listener');
  assert.equal(rejecting.liveDisposeListeners(), 0);

  configuration.change(SETTINGS.uiScale, 3);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(good.posted.at(-1), uiScaleMessage(3));
  assert.equal(refusing.posted.length, 3, 'a detached page was posted to again');
  assert.equal(rejecting.posted.length, 3);
  assert.equal(notDelivered.length, 2, 'a detached page was reported twice');
});

test('a push never waits inside the write queue: a page that never answers cannot block a setting write', { timeout: 2000 }, async () => {
  const { configuration, host } = rig(bothAt(0));
  const hanging = new FakeWebview('hanging', 'hangs');
  host.attach(hanging);

  await host.apply(ZOOM_UP, 'chat');
  await host.apply(ZOOM_UP, 'chat');

  assert.deepEqual(configuration.writes.map((w) => w.value), [1, 2]);
});

// ---------------------------------------------------------------------------------------------------
// Lifetimes
// ---------------------------------------------------------------------------------------------------

test('attaching the same page twice is refused — it would be pushed every message twice', () => {
  const { host } = rig();
  const page = new FakeWebview('page');
  host.attach(page);

  assert.throws(() => host.attach(page), /already attached/);
});

test('dispose() unhooks every subscription: no setting listener, no dispose listener, no further push, no further attach', () => {
  const { configuration, host } = rig(bothAt(0));
  const a = new FakeWebview('a');
  const b = new FakeWebview('b');
  host.attach(a);
  host.attach(b);
  assert.equal(configuration.liveListeners(), 2, 'one listener per setting while the host lives');

  host.dispose();
  host.dispose();
  configuration.change(SETTINGS.uiScale, 4);

  assert.equal(configuration.liveListeners(), 0);
  assert.equal(a.liveDisposeListeners(), 0);
  assert.equal(b.liveDisposeListeners(), 0);
  assert.equal(a.posted.length, 2);
  assert.equal(b.posted.length, 2);
  assert.throws(() => host.attach(new FakeWebview('late')), /disposed/);
});

test('press() and apply() after dispose() are refused at once, as attach() is, and write nothing', async () => {
  const { configuration, host, notSaved } = rig(bothAt(0));
  host.dispose();

  const outcomes = [
    () => host.press({ type: 'zoom', delta: 1, field: '' }, 'chat'),
    () => host.apply(TONE_DOWN, 'chat'),
  ].map((attempt) => {
    try {
      void attempt();
      return 'accepted';
    } catch (refusal: unknown) {
      return refusal instanceof Error ? refusal.message : String(refusal);
    }
  });
  await settle();

  assert.deepEqual(configuration.writes, [], 'a disposed host wrote a setting');
  assert.deepEqual(outcomes, [
    'the display host is disposed: a press now would write a setting no page is kept in step with',
    'the display host is disposed: a press now would write a setting no page is kept in step with',
  ]);
  assert.deepEqual(notSaved, [], 'a refusal is the caller\'s programming error, not a setting that could not be saved');
});

test('a press still QUEUED when dispose() runs is never written; the one already writing lands, and both resolve', { timeout: 2000 }, async () => {
  const { configuration, host, notSaved } = rig(bothAt(0));
  configuration.hold();
  const writing = host.apply(ZOOM_UP, 'chat');
  const queued = host.apply(ZOOM_UP, 'chat');
  await settle();

  host.dispose();
  configuration.release();
  await Promise.all([writing, queued]);

  assert.deepEqual(configuration.writes.map((w) => w.value), [1], 'a press queued behind a held write was written after dispose');
  assert.deepEqual(notSaved, [], 'a press dropped by dispose is not a setting that could not be saved');
});

test('a host whose second setting cannot be watched unhooks the first and rethrows — nothing is left hooked with no dispose to reach it', () => {
  const configuration = new FakeConfiguration([SETTINGS.uiScale, SETTINGS.textTone], bothAt(0));
  const refused = new Error('the textTone watch was refused');
  configuration.failNextWatch(SETTINGS.textTone, refused);

  assert.throws(
    () => createDisplayHost({ config: CONFIG, settings: SETTINGS, configuration, reporter: QUIET }),
    (reason: unknown) => reason === refused,
  );
  assert.equal(configuration.liveListeners(), 0, 'the uiScale listener outlived a host that was never made');
});

for (const delivery of ['refused', 'rejects'] as const) {
  test(`a pushNotDelivered that throws for a page that ${delivery} is no unhandled rejection: the page is let go and reporterFailed is told`, async () => {
    const configuration = new FakeConfiguration([SETTINGS.uiScale, SETTINGS.textTone], bothAt(0));
    const broken = new Error('the consumer\'s log line broke');
    const told: unknown[] = [];
    const host = createDisplayHost({
      config: CONFIG,
      settings: SETTINGS,
      configuration,
      reporter: { settingNotSaved: QUIET.settingNotSaved, pushNotDelivered: () => { throw broken; } },
      reporterFailed: (error) => { told.push(error); },
    });
    const page = new FakeWebview('page');
    host.attach(page);
    page.delivery = delivery;

    const unhandled = await unhandledRejectionsDuring(async () => {
      configuration.change(SETTINGS.uiScale, 2);
      await settle();
    });

    assert.deepEqual(unhandled, [], 'the detached push rejected and nobody observed it');
    assert.equal(page.liveDisposeListeners(), 0, 'the page was not let go before the report');
    assert.deepEqual(told, [broken], 'the reporter\'s own failure was swallowed');
    configuration.change(SETTINGS.uiScale, 3);
    assert.equal(page.posted.length, 3, 'a detached page was posted to again');
  });
}

test('a page whose own dispose hook throws as a failed push lets it go is no unhandled rejection either: reporterFailed is told that error', async () => {
  const configuration = new FakeConfiguration([SETTINGS.uiScale, SETTINGS.textTone], bothAt(0));
  const broken = new Error('the page\'s dispose hook broke');
  const told: unknown[] = [];
  const notices: PushNotDelivered[] = [];
  const host = createDisplayHost({
    config: CONFIG,
    settings: SETTINGS,
    configuration,
    reporter: { settingNotSaved: QUIET.settingNotSaved, pushNotDelivered: (notice) => { notices.push(notice); } },
    reporterFailed: (error) => { told.push(error); },
  });
  const page = new FakeWebview('page', 'refused');
  const adapted: WebviewPort = { postMessage: page.postMessage.bind(page), onDidDispose: () => ({ dispose: () => { throw broken; } }) };

  const unhandled = await unhandledRejectionsDuring(async () => {
    host.attach(adapted);
    await settle();
  });

  assert.deepEqual(unhandled, [], 'the detached push rejected and nobody observed it');
  assert.deepEqual(told, [broken]);
  assert.deepEqual(notices, [], 'the hook threw before the notice, so the error is what the consumer hears');
  configuration.change(SETTINGS.uiScale, 3);
  assert.equal(page.posted.length, 2, 'a page let go was posted to again');
});

test('without a reporterFailed a throwing pushNotDelivered goes to console.error — and one that throws itself does too, with both errors', async () => {
  const configuration = new FakeConfiguration([SETTINGS.uiScale, SETTINGS.textTone], bothAt(0));
  const broken = new Error('the consumer\'s log line broke');
  const alsoBroken = new Error('the consumer\'s reporterFailed broke');
  const plain = createDisplayHost({
    config: CONFIG, settings: SETTINGS, configuration,
    reporter: { settingNotSaved: QUIET.settingNotSaved, pushNotDelivered: () => { throw broken; } },
  });
  const doubly = createDisplayHost({
    config: CONFIG, settings: SETTINGS, configuration,
    reporter: { settingNotSaved: QUIET.settingNotSaved, pushNotDelivered: () => { throw broken; } },
    reporterFailed: () => { throw alsoBroken; },
  });
  plain.attach(new FakeWebview('plain', 'refused'));
  doubly.attach(new FakeWebview('doubly', 'rejects'));

  const logged: unknown[][] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => { logged.push(args); };
  let unhandled: unknown[];
  try {
    unhandled = await unhandledRejectionsDuring(settle);
  } finally {
    console.error = original;
  }

  assert.deepEqual(unhandled, []);
  assert.equal(logged.length, 2, `console.error was called ${logged.length} times`);
  assert.ok(logged.some((args) => args.includes(broken) && !args.includes(alsoBroken)), 'the default reporterFailed did not log the reporter\'s error');
  assert.ok(logged.some((args) => args.includes(broken) && args.includes(alsoBroken)), 'a throwing reporterFailed lost one of the two errors');
});

/** Two turns of the event loop: every detached delivery has settled, and Node has had its chance to report a rejection. */
async function settle(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
}

/** Every unhandled rejection Node reports while `run` runs and the loop settles after it. */
async function unhandledRejectionsDuring(run: () => Promise<void>): Promise<unknown[]> {
  const seen: unknown[] = [];
  const listener = (reason: unknown): void => { seen.push(reason); };
  process.on('unhandledRejection', listener);
  try {
    await run();
    await settle();
  } finally {
    process.off('unhandledRejection', listener);
  }

  return seen;
}
