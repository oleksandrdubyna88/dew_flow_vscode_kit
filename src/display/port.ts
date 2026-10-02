/**
 * The two ports the display host depends on INSTEAD of the `vscode` namespace.
 *
 * <p>Nothing in the kit imports `vscode` at run time (`architecture.test.ts` enforces it for every pure
 * module, and the host is kept pure too). The consumer adapts its own `vscode` objects to these shapes —
 * a few lines, written once per extension — and the host is unit-tested with a fake that is STRICTER than
 * the real API, never more permissive (`src/test/fakeDisplayPorts.ts`).</p>
 *
 * <p>The shapes are deliberately the subset of `vscode.Disposable`, `vscode.WorkspaceConfiguration`,
 * `vscode.workspace.onDidChangeConfiguration`, `vscode.Webview.postMessage` and
 * `vscode.WebviewPanel.onDidDispose` that ConnectOtherAIs' `uiScaleHost.ts` / `textToneHost.ts` used at
 * `1056aed9`. A consumer's adapter, for reference:</p>
 *
 * <pre>
 * const configuration: ConfigurationPort = {
 *   read: ({ section, key }) => vscode.workspace.getConfiguration(section).get(key),
 *   write: ({ section, key }, value) =>
 *     vscode.workspace.getConfiguration(section).update(key, value, vscode.ConfigurationTarget.Global),
 *   onDidChange: ({ section, key }, listener) =>
 *     vscode.workspace.onDidChangeConfiguration((change) => {
 *       if (change.affectsConfiguration(section + '.' + key)) { listener(); }
 *     }),
 * };
 * const page: WebviewPort = {
 *   postMessage: (message) => panel.webview.postMessage(message),
 *   onDidDispose: (listener) => panel.onDidDispose(listener),
 * };
 * </pre>
 */

/** Something that can be unhooked — the shape of `vscode.Disposable`. Disposing twice is a no-op. */
export interface Disposable {
  dispose(): void;
}

/** One setting, named as VS Code names it: the contribution's section and the key under it. */
export interface SettingName {
  /** The configuration section — `coai` for `coai.uiScale`. */
  readonly section: string;
  /** The key under the section — `uiScale` for `coai.uiScale`. */
  readonly key: string;
}

/**
 * The slice of `vscode.workspace` the host reads, writes and watches.
 *
 * <p>Not numeric on purpose: the help panel (E2.S3) keeps a language STRING through the same port, and
 * two ports for one `workspace` would be two adapters for a consumer to keep in step.</p>
 */
export interface ConfigurationPort {
  /**
   * The stored value, RAW — whatever the settings file holds, junk included. The host clamps; a port
   * that clamped too would be a second place the rule lives.
   */
  read(setting: SettingName): unknown;
  /**
   * Write the value to the USER (global) scope, so it syncs with the person rather than staying on one
   * machine. Rejects when the write fails (a read-only settings file, a setting the manifest does not
   * contribute); the host reports that through the consumer's reporter, once.
   */
  write(setting: SettingName, value: number | string): PromiseLike<void>;
  /**
   * Called, with nothing, each time this setting changes — from this host's own write, from the
   * Settings UI, from settings sync. The returned disposable unhooks the listener.
   */
  onDidChange(setting: SettingName, listener: () => void): Disposable;
}

/** What the host pushes to a page when the text size changes: the root font size and the `+3` label. */
export interface UiScaleMessage {
  readonly type: 'uiScale';
  readonly px: number;
  readonly label: string;
}

/**
 * What the host pushes to a page when the text tone changes: the chrome colour, the colour of the text a
 * person is reading, and the `−2` label. All three empty strings at the theme's own colour.
 */
export interface TextToneMessage {
  readonly type: 'textTone';
  readonly color: string;
  readonly read: string;
  readonly label: string;
}

/** The two messages the display host posts. The page scripts (`zoom.ts`, `tone.ts`) listen for exactly these. */
export type DisplayMessage = UiScaleMessage | TextToneMessage;

/**
 * One open page, as the host sees it: somewhere to post, and a dispose event to detach on.
 *
 * <p>`postMessage` is `vscode.Webview.postMessage`; `onDidDispose` is the PANEL's (`vscode.WebviewPanel`
 * / `vscode.WebviewView`), because a webview has no dispose event of its own — so the consumer's adapter
 * joins the two, as the docblock above shows.</p>
 */
export interface WebviewPort {
  /**
   * Deliver one message to the page. Resolves `true` when it was delivered; `false` when the webview is
   * gone or hidden with retention off; rejects when the webview is disposed. The host treats `false` and
   * a rejection alike: the page is reported and detached.
   */
  postMessage(message: DisplayMessage): PromiseLike<boolean>;
  /** Fires once when the page's panel is closed. The returned disposable unhooks the listener. */
  onDidDispose(listener: () => void): Disposable;
}
