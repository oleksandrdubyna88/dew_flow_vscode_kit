import assert from 'node:assert/strict';

import type { Disposable } from '../display/port';
import type { HelpPanelPort } from '../help/panel';
import { FakeWebview } from './fakeDisplayPorts';

/**
 * A strict fake of the help panel's port (`src/help/panel.ts`): the display host's `FakeWebview` — every
 * post recorded as a clone, dispose listeners counted — plus the two things a help panel does that a
 * bare webview does not: it is given its HTML, and it hands up the messages its page posts.
 *
 * <p><b>Stricter than `vscode`, never more permissive</b> (`common.generated-code-tests` § 3). Setting
 * the HTML of a disposed panel fails, where the real one throws too; a message delivered while nobody
 * listens FAILS, where the real API would drop it silently — a test that posts into a void is a test
 * that proves nothing. What a page posts is structured-cloned on its way up, as the real channel clones
 * it, so an inherited member never arrives and a function cannot be sent.</p>
 */
export class FakeHelpPanelPort extends FakeWebview implements HelpPanelPort {
  /** Every HTML the panel was given, oldest first. */
  readonly rendered: string[] = [];
  private messageListeners: readonly ((message: unknown) => void)[] = [];

  /** The HTML the panel shows now — the last one set, or nothing. */
  get html(): string {
    return this.rendered.at(-1) ?? '';
  }

  setHtml(html: string): void {
    assert.ok(!this.isDisposed, `${this.name}: the HTML of a disposed panel was set`);
    this.rendered.push(html);
  }

  onDidReceiveMessage(listener: (message: unknown) => void): Disposable {
    assert.ok(!this.isDisposed, `${this.name}: a message listener was added after dispose`);
    this.messageListeners = [...this.messageListeners, listener];

    return { dispose: () => { this.messageListeners = this.messageListeners.filter((held) => held !== listener); } };
  }

  /** The page posted `message`: every listener is handed its own clone, as the real channel delivers one. */
  receive(message: unknown): void {
    assert.ok(!this.isDisposed, `${this.name}: a message arrived from a disposed panel's page`);
    assert.ok(this.messageListeners.length > 0, `${this.name}: a message arrived but nobody listens — it would be lost`);
    for (const listener of this.messageListeners) {
      listener(structuredClone(message));
    }
  }

  /** How many message listeners are hooked right now. */
  liveMessageListeners(): number {
    return this.messageListeners.length;
  }
}
