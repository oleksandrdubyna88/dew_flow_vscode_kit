# dew_flow_vscode_kit

`@oleksandrdubyna88/vscode-webview-kit` — shared webview building blocks for the dew_flow family of
VS Code extensions.

| Part | What it gives an extension |
|---|---|
| `help` | a help page: typed articles (*what it is → why → setup → usage → what can go wrong*), five languages, a visible "not translated yet" fallback, **stale-translation detection** by digest, search, client-side routing, CSP with a nonce |
| `display` | the ± text size and ± text tone controls every page carries, their CSS and page script, and the host half that keeps every open page in step with one global setting |
| `settings` | one reporter for "a view setting could not be saved" |
| `webview` | `escapeHtml`, `jsonForScript`, a nonce, and the ordered write queue |

Extracted from ConnectOtherAIs on 2026-10-02; consumers: ConnectOtherAIs, wsl_care.

**Status:** being built — see [todo/PLAN_extract_the_kit.md](todo/PLAN_extract_the_kit.md).

## Use

```bash
npm install --save-dev @oleksandrdubyna88/vscode-webview-kit
```

The package is bundled into the extension by esbuild (`--external:vscode`), so it adds nothing to the
`.vsix` beyond the code actually used.

### The ± text size and ± text tone, end to end

Nothing in the kit imports `vscode`. The extension adapts its own objects to two small ports, once:

```ts
import * as vscode from 'vscode';
import {
  createDisplayConfig, createDisplayHost, toneControlHtml, toneCss, toneScript, toneStyle,
  zoomControlHtml, ZOOM_CSS, zoomScript, zoomStyle,
  type ConfigurationPort, type WebviewPort,
} from '@oleksandrdubyna88/vscode-webview-kit';

const configuration: ConfigurationPort = {
  read: ({ section, key }) => vscode.workspace.getConfiguration(section).get(key),
  write: ({ section, key }, value) =>
    vscode.workspace.getConfiguration(section).update(key, value, vscode.ConfigurationTarget.Global),
  onDidChange: ({ section, key }, listener) =>
    vscode.workspace.onDidChangeConfiguration((change) => {
      if (change.affectsConfiguration(`${section}.${key}`)) { listener(); }
    }),
};

const config = createDisplayConfig('ConnectOtherAIs', 'coai');          // product name, CSS prefix
const display = createDisplayHost({
  config,
  settings: { uiScale: { section: 'coai', key: 'uiScale' }, textTone: { section: 'coai', key: 'textTone' } },
  configuration,
  reporter: { settingNotSaved: notify, pushNotDelivered: (n) => log.error(n.detail) },
});
```

Per page: render the controls from `display.current()`, attach the page, hand it every message.

```ts
const { uiScale, textTone } = display.current();
// in the page's <style>: ZOOM_CSS + toneCss(config); inside its body rule: zoomStyle(uiScale) + toneStyle(textTone, config)
// in its header: zoomControlHtml(uiScale, config) + toneControlHtml(textTone, config)
// in its <script>: zoomScript() + toneScript(config)

const page: WebviewPort = {
  postMessage: (message) => panel.webview.postMessage(message),
  onDidDispose: (listener) => panel.onDidDispose(listener),
};
display.attach(page);                                                    // pushes both values now, and on every change
panel.webview.onDidReceiveMessage((message) => { void display.press(message, 'chat'); });
```

`press` validates the message first — a known `type`, a finite `delta` reduced to one step, a `field`
that is absent or empty — and answers `{ accepted: false, reason }` for anything else, writing nothing.
A valid press is clamped and written once, to the user scope, through a per-setting write queue; the
change event then pushes the new value to every attached page. A page whose `postMessage` resolves
`false` or rejects is reported through `pushNotDelivered` and detached. `display.dispose()` on
deactivate unhooks everything.

## Develop

See [.agents/PROJECT.md](.agents/PROJECT.md) for the commands and the rules this repository follows.

## License

MIT
