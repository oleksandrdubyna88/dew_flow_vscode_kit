import assert from 'node:assert/strict';

import type { ConfigurationPort, Disposable, DisplayMessage, SettingName, WebviewPort } from '../display/port';

/**
 * Strict fakes of the display host's two ports (`src/display/port.ts`).
 *
 * <p><b>Stricter than `vscode`, never more permissive</b> (`common.generated-code-tests` § 3). A setting
 * the test did not declare cannot be read, written or watched — the call fails naming it, where the real
 * API would answer `undefined` and let a host read the wrong key for ever. A message to a disposed webview
 * is counted AND thrown, where the real one only throws: the count is what lets a test assert that a
 * detached page received nothing even when the host swallows the throw. Everything posted is
 * structured-cloned, as a real `postMessage` clones it, so an uncloneable message fails here too.</p>
 *
 * <p>What a test can do that a real `workspace` cannot: hold every write open and release them together
 * (two quick presses), fail the next write with a reason, and change a setting from "outside" as settings
 * sync would. Every registration is counted, so "dispose unhooks" is an equality, not a hope.</p>
 */

/** One write the fake saw, as `section.key` → value, in the order it was applied. */
export interface RecordedWrite {
  readonly setting: string;
  readonly value: number | string;
}

interface SettingListener {
  readonly setting: string;
  readonly run: () => void;
}

/** A failure reason the test asked for — wrapped, because `undefined` is a legitimate reason to test with. */
interface Failure {
  readonly reason: unknown;
}

/** `coai.uiScale` — how a setting is spelled in the fake's own records and messages. */
export function settingKey(setting: SettingName): string {
  return `${setting.section}.${setting.key}`;
}

export class FakeConfiguration implements ConfigurationPort {
  /** Every applied write, oldest first. A held or failed write is not here. */
  readonly writes: RecordedWrite[] = [];
  private stored: ReadonlyMap<string, unknown>;
  private listeners: readonly SettingListener[] = [];
  private held: readonly (() => void)[] = [];
  /** `'all'`, one setting's key, or nothing — which writes {@link write} keeps pending. */
  private holding: 'all' | string | undefined = undefined;
  private nextFailure: Failure | undefined = undefined;
  /** Settings whose NEXT watch throws, keyed `section.key` — a registration the real API could refuse. */
  private watchFailures: ReadonlyMap<string, Failure> = new Map();

  /**
   * @param known the settings this fake will answer for — anything else is refused by name
   * @param initial stored values, keyed `section.key`; a known setting with no value reads `undefined`
   */
  constructor(private readonly known: readonly SettingName[], initial: Readonly<Record<string, unknown>> = {}) {
    this.stored = new Map(Object.entries(initial));
  }

  read(setting: SettingName): unknown {
    this.expect(setting, 'read');

    return this.stored.get(settingKey(setting));
  }

  write(setting: SettingName, value: number | string): Promise<void> {
    this.expect(setting, 'write');
    const failure = this.nextFailure;
    if (failure !== undefined) {
      this.nextFailure = undefined;

      return Promise.reject(failure.reason);
    }
    const apply = (): void => {
      this.writes.push({ setting: settingKey(setting), value });
      this.stored = new Map([...this.stored, [settingKey(setting), value]]);
      this.fire(settingKey(setting));
    };
    if (this.holding === 'all' || this.holding === settingKey(setting)) {
      return new Promise<void>((resolve) => {
        this.held = [...this.held, () => { apply(); resolve(); }];
      });
    }
    apply();

    return Promise.resolve();
  }

  onDidChange(setting: SettingName, listener: () => void): Disposable {
    this.expect(setting, 'watch');
    const failure = this.watchFailures.get(settingKey(setting));
    if (failure !== undefined) {
      this.watchFailures = new Map([...this.watchFailures].filter(([key]) => key !== settingKey(setting)));
      throw failure.reason;
    }
    const entry: SettingListener = { setting: settingKey(setting), run: listener };
    this.listeners = [...this.listeners, entry];

    return { dispose: () => { this.listeners = this.listeners.filter((held) => held !== entry); } };
  }

  /**
   * Keep writes from now on PENDING until {@link release} — the window two quick presses race in. Every
   * write, or only `setting`'s, so a test can block one setting and watch the other go through.
   */
  hold(setting?: SettingName): void {
    this.holding = setting === undefined ? 'all' : settingKey(setting);
  }

  /** Apply the held writes in order and stop holding, so a write queued behind them lands at once. */
  release(): void {
    this.holding = undefined;
    const pending = this.held;
    this.held = [];
    for (const apply of pending) {
      apply();
    }
  }

  /** The next write rejects with `reason` and is not applied. */
  failNextWrite(reason: unknown): void {
    this.nextFailure = { reason };
  }

  /**
   * The next `onDidChange` for `setting` throws `reason` and hooks nothing — a registration failing part
   * way through a constructor, after an earlier one succeeded. That one call only; the next is ordinary.
   */
  failNextWatch(setting: SettingName, reason: unknown): void {
    this.expect(setting, 'fail a watch of');
    this.watchFailures = new Map([...this.watchFailures, [settingKey(setting), { reason }]]);
  }

  /** A change from OUTSIDE this host — the Settings UI, settings sync: stored, then every listener told. */
  change(setting: SettingName, value: unknown): void {
    this.expect(setting, 'change');
    this.stored = new Map([...this.stored, [settingKey(setting), value]]);
    this.fire(settingKey(setting));
  }

  /** How many listeners are hooked right now — for `setting`, or for every known setting. */
  liveListeners(setting?: SettingName): number {
    return setting === undefined
      ? this.listeners.length
      : this.listeners.filter((held) => held.setting === settingKey(setting)).length;
  }

  private fire(setting: string): void {
    for (const listener of this.listeners.filter((held) => held.setting === setting)) {
      listener.run();
    }
  }

  private expect(setting: SettingName, what: string): void {
    const spelled = settingKey(setting);
    assert.ok(
      this.known.some((known) => settingKey(known) === spelled),
      `the host tried to ${what} ${spelled}, which this test never declared; known: ${this.known.map(settingKey).join(', ')}`,
    );
  }
}

/** How a fake webview answers a post: the real API's three outcomes, and a fourth no real one should show. */
export type Delivery = 'delivered' | 'refused' | 'rejects' | 'hangs';

export class FakeWebview implements WebviewPort {
  /** Every message handed to `postMessage` while this webview was alive, cloned into this realm. */
  readonly posted: DisplayMessage[] = [];
  /** Posts that arrived AFTER `dispose()` — each one also threw, as the real API throws. */
  postedAfterDispose = 0;
  /** How the NEXT post is answered — a test flips it after attach to stand for a page that has died. */
  delivery: Delivery;
  private disposeListeners: readonly (() => void)[] = [];
  private disposed = false;

  constructor(readonly name: string, delivery: Delivery = 'delivered') {
    this.delivery = delivery;
  }

  /** Whether `dispose()` has run — for a fake that extends this one and must refuse what a closed panel refuses. */
  get isDisposed(): boolean {
    return this.disposed;
  }

  postMessage(message: DisplayMessage): Promise<boolean> {
    if (this.disposed) {
      this.postedAfterDispose += 1;
      throw new Error(`Webview ${this.name} is disposed`);
    }
    this.posted.push(structuredClone(message));
    switch (this.delivery) {
      case 'delivered':
        return Promise.resolve(true);
      case 'refused':
        return Promise.resolve(false);
      case 'rejects':
        return Promise.reject(new Error(`webview ${this.name} refused the message`));
      case 'hangs':
        return new Promise<boolean>(() => undefined);
    }
  }

  onDidDispose(listener: () => void): Disposable {
    assert.ok(!this.disposed, `a dispose listener was added to ${this.name} after it was disposed`);
    this.disposeListeners = [...this.disposeListeners, listener];

    return { dispose: () => { this.disposeListeners = this.disposeListeners.filter((held) => held !== listener); } };
  }

  /** The panel closes: every dispose listener is told once, and nothing may be posted here again. */
  dispose(): void {
    assert.ok(!this.disposed, `${this.name} was disposed twice`);
    this.disposed = true;
    const told = this.disposeListeners;
    this.disposeListeners = [];
    for (const listener of told) {
      listener();
    }
  }

  /** How many dispose listeners are hooked right now. */
  liveDisposeListeners(): number {
    return this.disposeListeners.length;
  }
}
