import * as vscode from 'vscode';
import {
  createDisplayConfig,
  createDisplayHost,
  createHelpPanel,
  escapeHtml,
  jsonForScript,
  nonce,
  renderHelpPage,
  toneControlHtml,
  zoomControlHtml,
  type ConfigurationPort,
  type DisplayHost,
  type HelpPanel,
  type HelpPanelPort,
  type SettingNotSaved,
} from '@oleksandrdubyna88/vscode-webview-kit';
import { catalog } from './helpCatalog';

/**
 * A minimal consumer extension, written the way ConnectOtherAIs and wsl_care adapt the kit (README "Use"):
 * the `vscode` objects adapted to the kit's ports once, ONE display host, a help panel behind its port, and
 * a page of its own that uses the escapers. `pack-and-consume` type-checks this against the INSTALLED
 * package, bundles it with esbuild (`--bundle --external:vscode --format=cjs --platform=node`) and runs the
 * bundle under `run.mjs`'s `vscode` stub.
 */

const SECTION = 'kitFixture';

/** What the reporters were told — the runner asserts it stays empty on the happy path. */
export const notices: string[] = [];

const configuration: ConfigurationPort = {
  read: ({ section, key }) => vscode.workspace.getConfiguration(section).get(key),
  write: ({ section, key }, value) => vscode.workspace.getConfiguration(section).update(key, value, vscode.ConfigurationTarget.Global),
  onDidChange: ({ section, key }, listener) =>
    vscode.workspace.onDidChangeConfiguration((change) => {
      if (change.affectsConfiguration(`${section}.${key}`)) {
        listener();
      }
    }),
};

const notify = (notice: SettingNotSaved): Promise<void> => {
  notices.push(`${notice.source}: ${notice.detail}`);

  return Promise.resolve();
};

let display: DisplayHost | undefined;
let open: { readonly panel: vscode.WebviewPanel; readonly help: HelpPanel } | undefined;

function showHelp(host: DisplayHost): void {
  if (open !== undefined) {
    open.panel.reveal();
    return;
  }
  const panel = vscode.window.createWebviewPanel('kitFixtureHelp', 'Kit fixture — Help', vscode.ViewColumn.Active, {
    enableScripts: true,
    enableFindWidget: true,
    localResourceRoots: [],
  });
  const port: HelpPanelPort = {
    setHtml: (html) => {
      panel.webview.html = html;
    },
    postMessage: (message) => panel.webview.postMessage(message),
    onDidReceiveMessage: (listener) => panel.webview.onDidReceiveMessage(listener),
    onDidDispose: (listener) => panel.onDidDispose(listener),
  };
  const help = createHelpPanel({
    catalog,
    display: host,
    languageSetting: { section: SECTION, key: 'helpLanguage' },
    configuration,
    panel: port,
    settingNotSaved: notify,
    appendix: (id) => (id === 'install-the-fixture' ? `<p data-appendix>${escapeHtml('appendix <for> the fixture')}</p>` : ''),
  });
  open = { panel, help };
  panel.onDidDispose(() => {
    open = undefined;
  });
}

export function activate(context: vscode.ExtensionContext): void {
  const host = createDisplayHost({
    config: createDisplayConfig('KitFixture', 'kitfx'),
    settings: { uiScale: { section: SECTION, key: 'uiScale' }, textTone: { section: SECTION, key: 'textTone' } },
    configuration,
    reporter: { settingNotSaved: notify, pushNotDelivered: (notice) => notices.push(notice.detail) },
  });
  display = host;
  context.subscriptions.push(
    { dispose: () => host.dispose() },
    vscode.commands.registerCommand('kitFixture.showHelp', () => showHelp(host)),
  );
}

export function deactivate(): void {
  open?.help.dispose();
  display?.dispose();
}

/** A page of the consumer's own: a title it does not control, data for its script, and the two controls. */
export function statusHtml(title: string, data: unknown): string {
  if (display === undefined) {
    throw new Error('statusHtml before activate');
  }
  const { uiScale, textTone } = display.current();
  const once = nonce();

  return [
    `<h1>${escapeHtml(title)}</h1>`,
    zoomControlHtml(uiScale, display.config),
    toneControlHtml(textTone, display.config),
    `<script nonce="${once}">const data = ${jsonForScript(data)};</script>`,
  ].join('\n');
}

/** The pure page alone, as a consumer rendering the help itself would call it. */
export function helpPageHtml(language: 'en' | 'uk'): string {
  if (display === undefined) {
    throw new Error('helpPageHtml before activate');
  }

  return renderHelpPage({ catalog, language, display: display.config, nonce: nonce(), ...display.current() });
}
