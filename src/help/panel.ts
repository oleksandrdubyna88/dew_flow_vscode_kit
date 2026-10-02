import type { DisplayHost } from '../display/host';
import type { ConfigurationPort, Disposable, SettingName, WebviewPort } from '../display/port';
import { settingWritten, type SettingReporter } from '../settings/settingWritten';
import { hookAll } from '../webview/hooks';
import { nonce } from '../webview/nonce';
import { WriteQueue } from '../webview/writeQueue';
import { readHelpMessage, type HelpAction, type HelpMessageReading } from './messages';
import { renderHelpPage, type HelpAppendix } from './page';
import type { Catalog, HelpLanguage } from './types';

/**
 * The help panel's host half: one open help page, rendered on open and again on a language change, kept
 * in step with the text size and tone by the consumer's display host, its messages validated before
 * anything is written.
 *
 * <p>Extracted from ConnectOtherAIs' `helpPanel.ts` at `1056aed9` behind a port — the consumer creates
 * the `WebviewPanel` (that needs `vscode.window`) and adapts it to {@link HelpPanelPort}; what coai did
 * after `createWebviewPanel` is here. The language lives in a real setting (`coai.helpLanguage`) so it
 * syncs, and nothing else reads it, which scopes the choice to the help on purpose.</p>
 *
 * <p><b>What a message may do</b> (plan §1, gate round 1): `readHelpMessage` admits a press on a text
 * control and a language the CATALOG offers, and nothing else — an unknown type, a language outside the
 * list, a hostile shape are refused with a reason and write nothing, and `handle` never rejects for a
 * message's content. A press goes to the display host's `apply`, which clamps, writes once and pushes
 * the new value to this page live — not a re-render, which would lose the reader's place and the search
 * box's text (coai pushed too). A language is written through this panel's own write queue, so two
 * quick choices land in order, and the setting's change event re-renders; a failed write is reported
 * once through `settingWritten` with the consumer's reporter, naming `help`.</p>
 *
 * <p><b>Lifetime</b> (plan §5): four hooks — the language setting's listener, the port's message
 * listener, the display attachment, and the port's dispose event — made all or none (`webview/hooks.ts`:
 * if a later one cannot be registered, the earlier ones, the display attachment included, are undone
 * before the error is rethrown; gate, epic 2 code round, finding 3) — and `dispose()` unhooks all four,
 * whether called or reached through the panel closing. The display host is the consumer's and is left
 * alone. After dispose, `render` and `handle` throw: a closed page holds nothing, and a consumer driving
 * one is a programming error worth hearing about. The language write in flight still lands; a choice
 * still queued behind it is dropped.</p>
 */

/** One help panel, as the kit sees it: a webview to post to, whose HTML is set and whose page posts back. */
export interface HelpPanelPort extends WebviewPort {
  /** `panel.webview.html = html`. */
  setHtml(html: string): void;
  /** `panel.webview.onDidReceiveMessage`. The returned disposable unhooks the listener. */
  onDidReceiveMessage(listener: (message: unknown) => void): Disposable;
}

export interface HelpPanelOptions {
  readonly catalog: Catalog;
  /** The consumer's ONE display host: the help page is attached to it like every other page, and renders its controls from `display.config`. */
  readonly display: DisplayHost;
  /** The setting the language lives in: `coai.helpLanguage`. */
  readonly languageSetting: SettingName;
  readonly configuration: ConfigurationPort;
  readonly panel: HelpPanelPort;
  /** Told once per language write that failed (ConnectOtherAIs passes its `notify`). */
  readonly settingNotSaved: SettingReporter;
  /** Markup the consumer appends to an article — coai's prompt listing. */
  readonly appendix?: HelpAppendix;
}

export interface HelpPanel {
  /** The stored language, when the catalog offers it; English otherwise — junk, a missing value, a language with no module. */
  language(): HelpLanguage;
  /** Render the page now: the stored language, the display host's current values, a fresh nonce. Throws after {@link dispose}. */
  render(): void;
  /**
   * Read a message the page posted and act on it: a press through the display host, a language written
   * to the setting. Resolves with the reading once the write has landed or its failure has been reported;
   * a refused message writes nothing. Throws after {@link dispose}.
   */
  handle(message: unknown): Promise<HelpMessageReading>;
  /** Unhook the four hooks. Idempotent; also reached through the panel's own dispose event. */
  dispose(): void;
}

class Panel implements HelpPanel {
  private readonly hooks: readonly Disposable[];
  private readonly queue = new WriteQueue();
  private disposed = false;

  constructor(private readonly options: HelpPanelOptions) {
    const { configuration, languageSetting, panel, display } = options;
    // The page first, then the hooks — coai's order: the attachment pushes the current size and tone to a
    // page that already has its HTML, and a render that throws (a consumer's appendix) leaves nothing hooked.
    this.render();
    // All or none: a registration that throws undoes the ones before it — the display attachment included.
    this.hooks = hookAll([
      () => display.attach(panel),
      () => configuration.onDidChange(languageSetting, () => { this.render(); }),
      () => panel.onDidReceiveMessage((message) => { void this.handle(message); }),
      () => panel.onDidDispose(() => { this.dispose(); }),
    ]);
  }

  language(): HelpLanguage {
    const { catalog, configuration, languageSetting } = this.options;
    const value = configuration.read(languageSetting);

    return catalog.languages.find((language) => language === value) ?? 'en';
  }

  render(): void {
    this.live('render');
    const { catalog, display, panel, appendix } = this.options;
    const { uiScale, textTone } = display.current();
    const page = renderHelpPage({
      catalog,
      language: this.language(),
      display: display.config,
      nonce: nonce(),
      uiScale,
      textTone,
      ...(appendix === undefined ? {} : { appendix }),
    });
    panel.setHtml(page);
  }

  handle(message: unknown): Promise<HelpMessageReading> {
    this.live('handle a message');
    const reading = readHelpMessage(message, this.options.catalog.languages);

    return reading.accepted ? this.act(reading.action).then(() => reading) : Promise.resolve(reading);
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    for (const hook of this.hooks) {
      hook.dispose();
    }
  }

  private act(action: HelpAction): Promise<void> {
    return action.kind === 'press' ? this.options.display.apply(action.press, 'help') : this.setLanguage(action.language);
  }

  /**
   * One queued write of the language; its failure reaches the consumer's reporter, never the caller. A
   * choice still QUEUED when the panel is disposed is dropped — the display host's rule (gate, epic 2 code
   * round, finding 0): a closed page changes no setting. The write already in flight lands.
   */
  private setLanguage(language: HelpLanguage): Promise<void> {
    const { configuration, languageSetting, settingNotSaved } = this.options;
    const writing = this.queue.run(async () => {
      if (this.disposed) {
        return;
      }
      await configuration.write(languageSetting, language);
    });

    return settingWritten(writing, 'help', settingNotSaved);
  }

  private live(what: string): void {
    if (this.disposed) {
      throw new Error(`the help panel is disposed: it cannot ${what}`);
    }
  }
}

/** The one way to make a help panel. The page is rendered and four hooks are made at once, all or none; `dispose()` unhooks them. */
export function createHelpPanel(options: HelpPanelOptions): HelpPanel {
  return new Panel(options);
}
