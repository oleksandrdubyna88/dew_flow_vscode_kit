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

### The help catalog: stale translations fail YOUR build

Your articles stay yours: English in one module, one module per translated language, each a
`{ bodies, from }` — `from` records, per article, the digest of the English the translation was made from.

```ts
// helpRu.ts
import type { Translation } from '@oleksandrdubyna88/vscode-webview-kit';

export const RU: Translation = {
  bodies: { 'install-the-server': { title: '…', whatItIs: '…', why: '…', setup: '…', usage: '…', whatCanGoWrong: '…' } },
  from: { 'install-the-server': '1a2b3c4d' },
};

// helpCatalog.ts
import { createCatalog } from '@oleksandrdubyna88/vscode-webview-kit';

export const catalog = createCatalog({ articles: HELP_ARTICLES, translations: { ru: RU, uk: UK, de: DE, es: ES } });
```

`createCatalog` refuses a malformed catalog when the extension loads (a body for an article that does not
exist, a missing field, a `from` that is not 8 lowercase hex, …), naming what and where.
`bodyFor(catalog, article, language)` answers `{ body, fallback, stale }`: the translation, or English with
`fallback: true`; `stale` is `fresh`, `stale` (its `from` is an older English digest) or `unknown` (it has
no `from`).

**Stamp once.** Translation modules that predate the kit have no `from`, so every body reads `unknown`.
Stamp them a single time, on the assumption that what you ship today matches today's English, and paste the
result into the modules:

```ts
import { stampTranslations } from '@oleksandrdubyna88/vscode-webview-kit';
import { catalog } from './helpCatalog';

for (const [language, translation] of Object.entries(stampTranslations(catalog))) {
  console.log(language, JSON.stringify(translation.from, null, 2));   // → that module's `from`
}
```

Never call `stampTranslations` from the extension or a build: it would declare every translation fresh
forever.

**Then assert, in your own suite**, so an English edit committed without its translations goes red there
instead of reaching a reader:

```ts
import { everyArticleInEveryLanguage, staleTranslations } from '@oleksandrdubyna88/vscode-webview-kit';
import { catalog } from '../helpCatalog';

test('every translation was made from the current English', () => {
  assert.deepEqual(staleTranslations(catalog), []);   // each entry: { article, language, stale, from, current }
});

test('every article exists in every language the switch offers', () => {
  assert.deepEqual(everyArticleInEveryLanguage(catalog).missing, []);
});
```

When it goes red, re-check each listed translation against its English article and set its `from` to the
entry's `current`. In this repository `node scripts/help-digests.mjs <compiled catalog module>` prints
exactly those lines, grouped by language; it is not in the published package yet.

## Develop

See [.agents/PROJECT.md](.agents/PROJECT.md) for the commands and the rules this repository follows.

## License

MIT
