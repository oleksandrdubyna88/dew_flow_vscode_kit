import { settingWritten, type SettingReporter } from '../settings/settingWritten';
import { asText } from '../text/asText';
import { WriteQueue } from '../webview/writeQueue';
import type { DisplayConfig } from './config';
import { textToneMessage, uiScaleMessage } from './messages';
import type { ConfigurationPort, Disposable, DisplayMessage, SettingName, WebviewPort } from './port';
import { readPress, type Press, type PressReading } from './press';
import { clampTone } from './tone';
import { clampScale } from './zoom';

/**
 * The host half of the ± text size and ± text tone: read the two settings, apply a press, keep every
 * open page in step.
 *
 * <p>Extracted from ConnectOtherAIs' `uiScaleHost.ts` and `textToneHost.ts` at `1056aed9`, behind the
 * ports of `port.ts` instead of the `vscode` namespace. The guarantee is theirs: a press from any page
 * lands here, is CLAMPED here and WRITTEN to one global setting; the write raises the setting's change
 * event, and every attached page repaints from the one stored value. Two open pages never show two sizes,
 * because there is no per-page state to disagree.</p>
 *
 * <p><b>What this adds</b> (gate, epic 2 plan round, finding 1): a registry. `attach(webview)` returns a
 * disposable and is also undone by the page's own dispose event; a push iterates only attached pages; a
 * `postMessage` that resolves `false` or rejects is caught, reported through the consumer's reporter, and
 * detaches that page. A push never runs inside the write queue, so a page that never answers cannot block
 * a setting write — coai's `void webview.postMessage(…)` neither observed the outcome nor let the page
 * go, and a listener for a dead page lived on until the next reload.</p>
 *
 * <p><b>Growth</b> (plan §5): one write queue per setting, as long as the presses not yet written; the
 * set of attached pages, one entry per open page, each leaving on dispose, detach or a failed push.
 * `dispose()` unhooks both setting listeners and every page.</p>
 */

/** The two settings the host keeps, as the consumer contributes them: `coai.uiScale`, `coai.textTone`. */
export interface DisplaySettings {
  readonly uiScale: SettingName;
  readonly textTone: SettingName;
}

/** What the host tells the consumer when a pushed message did not reach a page. The page has been detached. */
export interface PushNotDelivered {
  /** Stable machine code. */
  readonly code: 'display-push-not-delivered';
  /** Which message was lost. */
  readonly message: DisplayMessage['type'];
  /** `postMessage resolved false`, or the rejection as text. */
  readonly detail: string;
}

/**
 * The consumer's two funnels. Neither is the kit's policy: `settingNotSaved` is ConnectOtherAIs' `notify`
 * (a counted, suppressed notice), `pushNotDelivered` its log line. **`pushNotDelivered` must not throw** —
 * it is called at the detached edge of a push, after the page is already let go, and a reporter that
 * throws there surfaces as an unhandled rejection: loud, as a consumer's own defect should be.
 */
export interface DisplayReporter {
  /** Told once per press whose write failed, through `settingWritten`. */
  readonly settingNotSaved: SettingReporter;
  /** Told once per page a push did not reach. */
  pushNotDelivered(notice: PushNotDelivered): void;
}

export interface DisplayHostOptions {
  readonly config: DisplayConfig;
  readonly settings: DisplaySettings;
  readonly configuration: ConfigurationPort;
  readonly reporter: DisplayReporter;
}

/** Both settings, clamped — what a page is rendered with when it opens. */
export interface DisplayValues {
  readonly uiScale: number;
  readonly textTone: number;
}

export interface DisplayHost {
  /** The stored values, clamped; junk reads as the theme's own (`0`). */
  current(): DisplayValues;
  /**
   * Keep one page in step for as long as it lives: both messages at once (so a page opened after a change
   * starts at the changed value), then the changed one on every change. The disposable detaches the page;
   * the page's own dispose event detaches it too. Throws after {@link dispose}, and for a page attached twice.
   */
  attach(webview: WebviewPort): Disposable;
  /**
   * Read a posted message and, when it is a press, apply it. Resolves with the reading once the write has
   * landed or its failure has been reported — never rejects. A refused message writes nothing.
   *
   * @param source which surface asked (`chat`, `help`) — named in the notice when the write fails
   */
  press(message: unknown, source: string): Promise<PressReading>;
  /** Apply a press a consumer's own parser produced. Same outcome contract as {@link press}. */
  apply(press: Press, source: string): Promise<void>;
  /** Unhook both setting listeners and every attached page. Pending writes still land. Idempotent. */
  dispose(): void;
}

/** One attached page: where to post, and the hook on its dispose event. */
interface Attachment {
  readonly webview: WebviewPort;
  readonly onDispose: Disposable;
}

class Host implements DisplayHost {
  private readonly hooks: readonly Disposable[];
  private readonly queues: Readonly<Record<PressKindKey, WriteQueue>> = { zoom: new WriteQueue(), tone: new WriteQueue() };
  private attached: ReadonlySet<Attachment> = new Set();
  private disposed = false;

  constructor(private readonly options: DisplayHostOptions) {
    const { configuration, settings } = options;
    this.hooks = [
      configuration.onDidChange(settings.uiScale, () => { this.push('uiScale'); }),
      configuration.onDidChange(settings.textTone, () => { this.push('textTone'); }),
    ];
  }

  current(): DisplayValues {
    const { configuration, settings } = this.options;

    return {
      uiScale: clampScale(configuration.read(settings.uiScale)),
      textTone: clampTone(configuration.read(settings.textTone)),
    };
  }

  attach(webview: WebviewPort): Disposable {
    if (this.disposed) {
      throw new Error('the display host is disposed: a page attached now would never be pushed a change');
    }
    if ([...this.attached].some((held) => held.webview === webview)) {
      throw new Error('this webview is already attached: it would be pushed every message twice');
    }
    const attachment: Attachment = { webview, onDispose: webview.onDidDispose(() => { this.detach(attachment); }) };
    this.attached = new Set([...this.attached, attachment]);
    void this.deliver(attachment, this.messageFor('uiScale'));
    void this.deliver(attachment, this.messageFor('textTone'));

    return { dispose: () => { this.detach(attachment); } };
  }

  async press(message: unknown, source: string): Promise<PressReading> {
    const reading = readPress(message);
    if (reading.accepted) {
      await this.apply(reading.press, source);
    }

    return reading;
  }

  apply(press: Press, source: string): Promise<void> {
    // The read happens INSIDE the queued work, so the second of two quick presses reads what the first wrote.
    const writing = this.queues[press.kind].run(() => this.write(press));

    return settingWritten(writing, source, this.options.reporter.settingNotSaved);
  }

  dispose(): void {
    this.disposed = true;
    for (const hook of this.hooks) {
      hook.dispose();
    }
    for (const attachment of this.attached) {
      this.detach(attachment);
    }
  }

  /** Read, step, clamp, write — one setting, at the moment the queue reaches this press. */
  private async write(press: Press): Promise<void> {
    const { configuration, settings } = this.options;
    const setting = press.kind === 'zoom' ? settings.uiScale : settings.textTone;
    const clamp = press.kind === 'zoom' ? clampScale : clampTone;

    await configuration.write(setting, clamp(clamp(configuration.read(setting)) + press.step));
  }

  /** The changed setting's message to every attached page — each delivery on its own, none awaited here. */
  private push(kind: DisplayMessage['type']): void {
    const message = this.messageFor(kind);
    for (const attachment of this.attached) {
      void this.deliver(attachment, message);
    }
  }

  private messageFor(kind: DisplayMessage['type']): DisplayMessage {
    const { uiScale, textTone } = this.current();

    return kind === 'uiScale' ? uiScaleMessage(uiScale) : textToneMessage(textTone, this.options.config);
  }

  /** One page, one message: a `false` or a rejection means the page is gone — report it, let it go. */
  private async deliver(attachment: Attachment, message: DisplayMessage): Promise<void> {
    try {
      if (await attachment.webview.postMessage(message)) {
        return;
      }
      this.lost(attachment, message.type, 'postMessage resolved false');
    } catch (reason: unknown) {
      this.lost(attachment, message.type, asText(reason));
    }
  }

  /** Detach first, then report — a page that already left (its panel closed mid-push) is gone, not broken. */
  private lost(attachment: Attachment, kind: DisplayMessage['type'], detail: string): void {
    if (!this.attached.has(attachment)) {
      return;
    }
    this.detach(attachment);
    this.options.reporter.pushNotDelivered({ code: 'display-push-not-delivered', message: kind, detail });
  }

  private detach(attachment: Attachment): void {
    if (!this.attached.has(attachment)) {
      return;
    }
    this.attached = new Set([...this.attached].filter((held) => held !== attachment));
    attachment.onDispose.dispose();
  }
}

type PressKindKey = Press['kind'];

/** The one way to make a host. Two listeners are hooked at once; `dispose()` unhooks them. */
export function createDisplayHost(options: DisplayHostOptions): DisplayHost {
  return new Host(options);
}
