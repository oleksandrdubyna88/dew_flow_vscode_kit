import assert from 'node:assert/strict';
import { test } from 'node:test';

import { FakeHelpPanelPort } from './fakeHelpPanelPort';

/**
 * The fake is code under test (`common.generated-code-tests` § 3): each test here pins one promise the
 * panel tests lean on, so a green panel suite cannot be green because the fake let something through.
 */

test('the HTML set on the panel is recorded in order, and html is the latest', () => {
  const panel = new FakeHelpPanelPort('help');
  assert.equal(panel.html, '');

  panel.setHtml('<p>one</p>');
  panel.setHtml('<p>two</p>');

  assert.deepEqual(panel.rendered, ['<p>one</p>', '<p>two</p>']);
  assert.equal(panel.html, '<p>two</p>');
});

test('a received message reaches every listener as its own clone — never the object the test holds', () => {
  const panel = new FakeHelpPanelPort('help');
  const seen: unknown[] = [];
  panel.onDidReceiveMessage((message) => { seen.push(message); });
  panel.onDidReceiveMessage((message) => { seen.push(message); });
  const message = { type: 'language', language: 'ru', field: '' };

  panel.receive(message);

  assert.deepEqual(seen, [message, message]);
  assert.notEqual(seen[0], message, 'the listener was handed the test\'s own object');
  assert.notEqual(seen[0], seen[1], 'two listeners shared one clone');
});

test('a received message is cloned as the real channel clones it: an inherited member does not arrive, a function cannot be sent', () => {
  const panel = new FakeHelpPanelPort('help');
  const seen: unknown[] = [];
  panel.onDidReceiveMessage((message) => { seen.push(message); });

  panel.receive(Object.create({ type: 'language', language: 'ru' }) as unknown);
  assert.deepEqual(seen, [{}]);
  assert.throws(() => panel.receive({ run: () => 1 }), /could not be cloned/);
});

test('a disposed listener is not told again, and the live count follows', () => {
  const panel = new FakeHelpPanelPort('help');
  let told = 0;
  const hook = panel.onDidReceiveMessage(() => { told += 1; });
  panel.onDidReceiveMessage(() => undefined);
  assert.equal(panel.liveMessageListeners(), 2);

  panel.receive({ type: 'x' });
  hook.dispose();
  hook.dispose();
  panel.receive({ type: 'x' });

  assert.equal(told, 1);
  assert.equal(panel.liveMessageListeners(), 1);
});

test('a message that arrives while nobody listens fails, instead of being lost in silence', () => {
  const panel = new FakeHelpPanelPort('help');

  assert.throws(() => panel.receive({ type: 'language', language: 'ru' }), /nobody listens/);
});

test('after dispose: no HTML can be set, no listener added, no message received — and it is still the display fake underneath', () => {
  const panel = new FakeHelpPanelPort('help');
  let disposed = 0;
  panel.onDidDispose(() => { disposed += 1; });
  panel.onDidReceiveMessage(() => undefined);

  panel.dispose();

  assert.equal(disposed, 1);
  assert.equal(panel.isDisposed, true);
  assert.throws(() => panel.setHtml('<p>late</p>'), /disposed panel was set/);
  assert.throws(() => panel.onDidReceiveMessage(() => undefined), /after dispose/);
  assert.throws(() => panel.receive({ type: 'x' }), /disposed panel/);
  assert.throws(() => panel.postMessage({ type: 'uiScale', px: 13, label: '' }), /is disposed/);
  assert.equal(panel.postedAfterDispose, 1);
  assert.equal(panel.liveMessageListeners(), 1, 'the listener list is what it was — the port is closed, not emptied; the PANEL unhooks its own');
});
