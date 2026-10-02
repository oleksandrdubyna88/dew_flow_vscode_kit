# dew_flow_vscode_kit

`@oleksandrdubyna88/vscode-webview-kit` — shared webview building blocks for the dew_flow family of
VS Code extensions.

| Part | What it gives an extension |
|---|---|
| `help` | a help page: typed articles (*what it is → why → setup → usage → what can go wrong*), five languages, a visible "not translated yet" fallback, **stale-translation detection** by digest, search, client-side routing, CSP with a nonce |
| `display` | the ± text size and ± text tone controls every page carries, their CSS and page script, and the host half that keeps every open page in step with one global setting |
| `settings` | one reporter for "a view setting could not be saved" |
| `webview` | `escapeHtml`, `jsonForScript`, a nonce, and the ordered write queue |
| `text` | `asText` — text, whatever the caller actually had |
| bin `vscode-webview-kit-help-digests` | prints the `from` line each stale or unchecked translation needs |

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
deactivate unhooks everything; `attach`, `press` and `apply` throw after it, and a press still queued
behind a write in flight is dropped rather than written.

A push runs detached, so nothing it does can reject: if your `pushNotDelivered` throws (or a page's
dispose hook does as the page is let go), the error goes to the optional `reporterFailed` —
`console.error` when you pass none:

```ts
const display = createDisplayHost({ config, settings, configuration, reporter, reporterFailed: (error) => log.error(error) });
```

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
exist, a missing field, a `from` that is not 8 lowercase hex, …), naming what and where. The catalog
keeps frozen COPIES of what it checked, so editing your modules' objects afterwards changes nothing it
answers — make a new catalog instead.
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
entry's `current`. The package ships a bin that prints exactly those lines, grouped by language:

```bash
npx vscode-webview-kit-help-digests out/helpCatalog.js                     # exit 1 and the lines to paste; exit 0 when nothing is stale
npx vscode-webview-kit-help-digests out/helpCatalog.js --export myCatalog  # the export is called `catalog` by default
```

It re-makes the catalog with the kit's own `createCatalog` (a broken module is refused there as at load,
exit 2) and lists what `staleTranslations` lists. Without `--kit <entry>` it uses the kit it was installed
with, found beside the script — never relative to the directory you run it from.

### The help page and panel, end to end

The page is pure — `renderHelpPage` is a function from the catalog, a language, the display config and a
**nonce** to a string — and the panel is its host half, behind one more port. The extension creates the
`WebviewPanel` (that needs `vscode.window`) and adapts it once:

```ts
import * as vscode from 'vscode';
import { createHelpPanel, type HelpPanel, type HelpPanelPort } from '@oleksandrdubyna88/vscode-webview-kit';
import { catalog } from './helpCatalog';
import { configuration, display } from './display';   // the ports and the display host from the section above

let open: { panel: vscode.WebviewPanel; help: HelpPanel } | undefined;

export function showHelp(): void {
  if (open !== undefined) { open.panel.reveal(); return; }
  const panel = vscode.window.createWebviewPanel('coaiHelp', 'ConnectOtherAIs — Help', vscode.ViewColumn.Active,
    { enableScripts: true, enableFindWidget: true, localResourceRoots: [] });
  const port: HelpPanelPort = {
    setHtml: (html) => { panel.webview.html = html; },
    postMessage: (message) => panel.webview.postMessage(message),
    onDidReceiveMessage: (listener) => panel.webview.onDidReceiveMessage(listener),
    onDidDispose: (listener) => panel.onDidDispose(listener),
  };
  const help = createHelpPanel({
    catalog,
    display,                                                  // the ONE display host: the help page is attached to it
    languageSetting: { section: 'coai', key: 'helpLanguage' },
    configuration,
    panel: port,
    settingNotSaved: notify,
    appendix: (id, language) => (id === 'prompts-in-full' ? promptsHtml(language) : ''),   // optional; your own, escaped markup
  });
  open = { panel, help };
  panel.onDidDispose(() => { open = undefined; });
}
```

`createHelpPanel` renders the page at once — the stored language (English when the value is junk or a
language the catalog has no module for), the display host's current size and tone, a fresh nonce — and
re-renders when the language setting changes. Every message the page posts is read before anything
happens: a `zoom` / `tone` press goes to the display host, which writes once and pushes the new value back
to the page live; a `language` is written only when it is one of `catalog.languages`; an unknown type, a
language outside that list and any other shape are refused with a reason and write nothing. A failed
language write is reported once through `settingNotSaved`, naming `help`. When the panel closes — or on
`help.dispose()` — its four hooks are unhooked (the language listener, the message listener, the display
attachment, the dispose listener); the display host is yours and stays. The four are made all or none: if
one cannot be registered, `createHelpPanel` undoes the ones before it — the display attachment included —
and rethrows.

**The page's CSP** is `default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-…'`, with a nonce
minted per render on the page's one script and no inline handler anywhere. `renderHelpPage` refuses a
nonce shorter than 22 base64 characters and a language the catalog does not offer. A translation `bodyFor`
answers as `stale` or `unknown` carries a note under the article's title, in the help's language; a fresh
catalog renders no note at all, so for ConnectOtherAIs' configuration the page is byte-identical to what
coai rendered before the extraction.

The pure half alone, to render the page yourself:

```ts
import { nonce, renderHelpPage } from '@oleksandrdubyna88/vscode-webview-kit';

const html = renderHelpPage({ catalog, language: 'ru', display: display.config, nonce: nonce(), ...display.current() });
```

## Develop

See [.agents/PROJECT.md](.agents/PROJECT.md) for the commands and the rules this repository follows.

## License

MIT
