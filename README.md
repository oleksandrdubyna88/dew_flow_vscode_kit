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
| `components` (subpath `…/components`) | webview components built with the DOM (no `innerHTML`, no `style`): `Tabs` with a status per tab, a `DataTable` you sort, search and reveal a hidden value in, a `RecommendationCard`; their stylesheet `…/components.css` with theme tokens on VS Code's `--vscode-*` variables; a Storybook of every state |
| bin `vscode-webview-kit-help-digests` | prints the `from` line each stale or unchecked translation needs |

Extracted from ConnectOtherAIs on 2026-10-02; consumers: ConnectOtherAIs, wsl_care.

**Status:** being built — see [todo/PLAN_extract_the_kit.md](todo/PLAN_extract_the_kit.md). **0.1.0 never
reached a registry**: its release run failed at `npm publish` on npmjs (E403, run 38925094342), so the tag
`v0.1.0` stays, unpublished. The next release, **0.1.1**, is the first publish — to GitHub Packages, with an
artifact attestation ([research/PLAN_publish_to_github_packages.md](research/PLAN_publish_to_github_packages.md)).
The components (`…/components`, in 0.2.0) are in [todo/PLAN_kit_components_storybook.md](todo/PLAN_kit_components_storybook.md).

## Use

The package is on **GitHub Packages** (`npm.pkg.github.com`), not on npmjs. GitHub Packages serves npm
packages to a client that sends a token, even when the package is public.

In the consumer repository, a committed `.npmrc` (the scope of the package goes to GitHub Packages; the token
is read from the environment, never written in the file):

```
@oleksandrdubyna88:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${NODE_AUTH_TOKEN}
```

Then install the EXACT version:

```bash
npm install --save-dev --save-exact @oleksandrdubyna88/vscode-webview-kit@<version>
```

- **In CI**, the job that runs `npm ci` or `npm install` gets `permissions: contents: read, packages: read`
  and `NODE_AUTH_TOKEN: ${{ secrets.GITHUB_TOKEN }}` on that install step (or `actions/setup-node` with
  `registry-url: https://npm.pkg.github.com` and `scope: '@oleksandrdubyna88'`). GitHub's documentation says
  a package that is public can be downloaded by a workflow in any repository; a private one needs this
  package's settings to give that repository access (*Manage Actions access*). A token is needed either way.
- **Locally**, set `NODE_AUTH_TOKEN` to a personal access token (classic) with `read:packages`.
  Fine-grained tokens are not accepted by the npm registry of GitHub Packages.

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

### Webview components: Tabs, DataTable, RecommendationCard

These run INSIDE the webview, so they live behind their own entry, `…/components` — the package root re-exports the
host's nonce, which imports `node:crypto`, and must never be bundled for a browser. Bundle a webview entry of your
own with esbuild for the browser and import the stylesheet beside it:

```ts
// src/webview/fullView.ts → esbuild { bundle: true, platform: 'browser', format: 'iife' } → media/full.js + media/full.css
import { createDataTable, createRecommendationCard, createTabs } from '@oleksandrdubyna88/vscode-webview-kit/components';
import '@oleksandrdubyna88/vscode-webview-kit/components.css';
```

TypeScript 6 checks side-effect imports, so declare stylesheets once (`declare module '*.css';` in a `.d.ts`), and
type-check the webview entry with `lib: ["ES2022", "DOM"]`. The page links the emitted CSS under its nonce —
`<link rel="stylesheet" nonce="…" href="<webview URI of media/full.css>">` — and needs nothing more: the components
set no `style` attribute and use no `innerHTML`, so a CSP of `default-src 'none'; script-src 'nonce-…'; style-src
'nonce-…'` holds. The file inside the package is `dist/components/components.css`, if you would rather copy it.

Every component takes the document as its first argument — the real `document` here, with no cast; what it returns is
your page's own `HTMLElement`:

```ts
const table = createDataTable(document, {
  label: 'Processes',
  columns: [
    { key: 'pid', header: 'PID', value: (row) => row.pid, align: 'end' },
    { key: 'held', header: 'Held', value: (row) => row.heldBytes, format: (bytes) => mib(Number(bytes)), align: 'end' },
    { key: 'program', header: 'Program', value: (row) => row.program },
  ],
  rows,
  search: { label: 'Search processes' },
  reveal: {
    header: 'Command line',
    button: (row) => `Show the command line of ${row.program}`,
    onReveal: (index) => vscode.postMessage({ type: 'reveal', index }),   // the kit tells you an index, nothing else
  },
});
// when the host answers: table.reveal(index, commandLine); a fresh poll: table.setRows(rows) (revealed values drop)

const card = createRecommendationCard(document, {
  tone: 'warning', word: 'Warning', sentence: 'Memory is low. Drop caches to free about 2.1 GiB.',
  action: myDropCachesButton,              // ONE button you built and wired; the kit only places it
  evidence: ['RAM available 6 %', 'Swap 92 % used'],
});

const tabs = createTabs(document, {
  idPrefix: 'full', label: 'Sides',
  tabs: [
    { id: 'linux', label: 'Linux', content: table.root, status: { tone: 'warning', word: '2 warnings' } },
    { id: 'advice', label: 'Advice', content: card },
  ],
  onSelect: (id) => vscode.setState({ tab: id }),
});
document.getElementById('full')?.appendChild(tabs.root);
tabs.setStatus('linux', { tone: 'ok', word: 'All fine' });   // live, as data arrives
```

- **Every word and every unit is yours.** A column's `value` sorts (a number, a string, or `null` for absent) and its
  `format` shows; the kit formats nothing but absence, which it shows as `—` and sorts last both ways. A status is a
  tone (`neutral`, `info`, `ok`, `warning`, `critical`) AND its word — colour is never the only signal.
- **Sorting** is a `button` in each sortable `th`, so a click, Enter and Space all sort; `aria-sort` follows.
  **Tabs** are the WAI-ARIA pattern: arrow keys (wrapping), Home and End, a roving `tabindex`; `onSelect` hears a
  person's choice, never `select()` from code.
- **The reveal never puts a hidden value in the page before you hand it over**, and `onReveal` receives the row's
  index in the `rows` you gave — not its place after a sort or a search.
- **A table never scrolls sideways and is never wider than its box.** Columns shrink and wrap; a header breaks only
  between words, a cell breaks a word only as a last resort. Below a width OF THE TABLE ITSELF (`.kit-table` is a CSS
  size container, so a table in a narrow card adapts on a wide screen too) every row stacks into "label: value" lines,
  and the header row becomes a wrapped row of sort buttons after the words "Sort by". The option is
  `stack: 'narrow' | 'medium' | 'wide' | 'never'` — below `30em`, `40em`, `60em` of the table's width, or at no
  width — `'medium'` when absent; anything else is refused naming the four. Every body cell carries `data-kit-label`
  (its column's header, set with `setAttribute`) for the stylesheet to draw. Keep headers short; a consumer who wants
  fewer columns passes fewer columns — the kit hides none.
- **What your page harness must allow** (a strict one refuses whatever it does not model): the tags `div span strong
  p ul li button input table thead tbody tr th td`; the attributes `role id type tabindex scope colspan aria-*
  data-kit-*`; `className`, `textContent`, `hidden`, `focus()`, an input's `value`; the events `click`, `keydown`,
  `input`. That is the whole surface (`src/components/dom.ts`).
- **Theme tokens** are `--kit-*` custom properties declared on each component's root and mapped onto `--vscode-*`
  variables, so light, dark and high-contrast themes are VS Code's to set; every size is in `em`, so the ± text size
  scales them.

**The Storybook** shows every component and state, and the existing display controls and Help viewer, under VS Code's
four reference themes and three text sizes, with axe's panel: `npm run storybook` (or `npm run build-storybook` for
`storybook-static/`). It is a development tool; nothing of it ships.

**The layout check** proves the "fits its box" rule in a real browser, because jsdom has no layout:
`npm run layout-check` renders every DOM case of the gallery with the stylesheet into one page and drives headless
Chrome over the DevTools protocol (Node's own `WebSocket`; no dependency) at 300, 1280 and 1920 px × the four themes ×
three text sizes, each case also inside an `18em` box. It is RED, naming the case, when the page scrolls sideways, an
element ends past the window's edge, a box holds content wider than itself, or a table is wider than what holds it.
Chrome comes from `CHROME_PATH` (a path that names nothing is an error, never a fallback to another browser), then the
usual install paths (Edge on Windows as a fallback); none found is exit 3, never a skip. `npm run layout-check -- --companion` is its own proof: a planted `min-width` and a planted `nowrap`, in
copies of the stylesheet, must each turn it RED naming a DataTable case, and the real stylesheet's SHA-256 is compared
after. CI runs both in the `storybook` job on ubuntu. The profile lives in the git-ignored `testsToDelete-layout-check/`,
removed when the run ends.

## Develop

See [.agents/PROJECT.md](.agents/PROJECT.md) for the commands and the rules this repository follows.

### Check the package as a consumer gets it

```bash
npm run pack-and-consume                          # pack → read the tarball → install → typecheck → bundle → run → bin
node scripts/pack-and-consume.mjs --broken-import # the same with a misspelled import: must exit 1 at "typecheck"
```

`npm pack` builds `dist/` through `prepack` (the script deletes `dist/` first, so nothing stale can ship).
The tarball is installed offline into a temporary copy of `test/consumer-fixture/` — a minimal extension
that adapts `vscode` to the kit's ports as shown above — type-checked against the INSTALLED `.d.ts`,
bundled with esbuild (`--bundle --external:vscode --format=cjs --platform=node`), run under node with a
`vscode` stub, and the installed `vscode-webview-kit-help-digests` is started through npm's shim. Each line
names its step; a failure names the step it stopped at. Nothing is downloaded: TypeScript and esbuild come
from this repository's devDependencies, and the kit has no runtime dependencies. `npm test` runs both
modes, so it rebuilds `dist/`; CI also runs it on its own on ubuntu and windows
(`.github/workflows/pack-and-consume.yml`).

`node scripts/pack-and-consume.mjs --published <version>` runs the same steps over the tarball GitHub
Packages serves for that version — downloaded, never built — which is how a release is checked after it is
public. It needs `NODE_AUTH_TOKEN` (a classic personal access token with `read:packages` locally; in CI the
job's `GITHUB_TOKEN` with `packages: read`) and stops with exit 2, before any step, when it is empty.

## Release and rollback

Releases are cut by [release-please](https://github.com/googleapis/release-please) and published to
**GitHub Packages** by CI, with the job's own `GITHUB_TOKEN` and a GitHub artifact attestation. There is no
npm token anywhere. Nobody publishes from a laptop. **Nothing has been published yet**: 0.1.0 never reached a
registry, and 0.1.1 is the first publish. The pipeline below is in the repository and waits for the one-time
setup at the end of this section.

### How a release happens

1. **Commits land on `main`** in the conventional shape. The commit TYPE is the version: `feat:` a minor,
   `fix:` / `perf:` a patch; `docs:`, `test:`, `ci:`, `chore:`, `refactor:`, `build:` release nothing. A
   commit that touches only `.github/` never releases, and the title check refuses a releasing title whose
   changes are documentation alone (`.github/scripts/docs-only-title.mjs`).
2. **`release-please.yml`** (every push to `main`) opens or updates one pull request, *chore(main): release
   x.y.z*, which bumps `package.json` and `package-lock.json` and writes `CHANGELOG.md`. It runs with the
   release App's token, so that pull request gets CI like any other.
3. **Merging it is the decision to release.** The run that merge starts tags `v<x.y.z>` (no component) and
   creates the published GitHub release. The first release that publishes is **0.1.1**: 0.1.0 was cut first
   (`initial-version`, with an empty manifest — see `$bootstrap` in `release-please-config.json`) but its
   publish failed and it never reached a registry; the notes of 0.1.1 say so.
4. **`release.yml`** (started by that published release, and by nothing else):
   **guard** — the tag is exactly `v<major>.<minor>.<patch>`, the release was made by the App, it is not a
   draft or pre-release, its commit is on `main`, and `package.json` at the tag says the same version;
   **pack-and-consume** — the packed tarball installs, type-checks, bundles and runs in the consumer fixture
   on ubuntu and windows; then three more jobs, **build → publish → consume**, so that no dependency code
   runs beside the publish and signing credentials:
   1. **build** — holds `contents: read` and nothing else, and is the only job that runs dependency code:
      it re-checks the guard on its own checkout, runs `npm ci` and `npm test`, then **packs once** — one
      `npm pack` into the runner's temp folder, exactly one `.tgz` (`prepack` builds `dist/` inside it), a
      `.sha256` beside it — and uploads both as the artifact `release-tarball`, kept 30 days;
   2. **publish** — needs the guard, pack-and-consume and build, runs in the GitHub environment `npm`, and is
      the only job with `packages: write`, `id-token: write` and `attestations: write`. It checks out
      `scripts/` alone and runs no dependency code, only these steps in this order: download the artifact;
      check the tarball against its `.sha256` (a corruption check of the round trip — not a provenance bind,
      because the digest travels with the tarball); **attest** — `actions/attest-build-provenance` signs SLSA
      v1 provenance of THAT tarball with the job's OIDC token and stores it on this repository; **publish
      once** — `node scripts/publish-once.mjs <that tarball>` runs `npm publish <that tarball>` with the
      job's `GITHUB_TOKEN`, unless GitHub Packages already serves this version (see "When a publish fails").
      `npm publish <tarball>` runs no lifecycle script — npm runs `prepublishOnly` only for a directory — so
      what guards the published bytes is the build job's own `npm test` and the `prepack` build in its pack
      step; **verify** — `scripts/verify-published.mjs --tarball <that tarball>` proves what GitHub Packages
      SERVES: the version; that the served tarball's sha512 is the packument's `dist.integrity` and the
      attested file's (this is what binds the published bytes to the attested ones); and that `gh
      attestation verify` accepts the SERVED bytes for the identity below;
   3. **consume** — holds `contents: read` and `packages: read`, needs publish, and runs the consumer
      fixture against the published version (`pack-and-consume.mjs --published`). It needs `npm ci`
      (TypeScript, esbuild), so it cannot share a job with the credentials.

   **The limit, said plainly:** a compromised build dependency can still choose the bytes it packs, and the
   attestation will then truthfully say "built by `release.yml` at the tag". The split keeps the publish
   token and the signing identity away from dependency code; it does not make the build trustworthy. The
   defences for the build stay the lockfile, `npm ci` and the tests.
5. **Afterwards**, from a checkout of the tag, run [POST_DEPLOY.md](POST_DEPLOY.md) and stamp it. It needs
   `NODE_AUTH_TOKEN` (a classic personal access token with `read:packages`) and a `gh` login with
   `read:packages` (`gh auth refresh -s read:packages`):

   ```bash
   node .agents/conventions/tools/post-deploy-check.mjs --target 0.1.1 --timeout 300000
   ```

The scripts' npm (`scripts/lib/npm.mjs`, `registryEnv`) is pinned: it refuses any registry but
`https://npm.pkg.github.com` (one trailing slash tolerated) and any package scope that is not the owner of
`package.json`'s repository, so a typo or a changed manifest can never send the job's package-write token to
another host or publish under another owner.

Consumers pin the EXACT version and switch in their own pull requests, only after a version is published
and verified.

### The attestation identity

Every version is published with a GitHub artifact attestation: SLSA v1 provenance, signed through GitHub's
OIDC issuer and Sigstore, whose subject is the sha256 of the very tarball that was published. For this
package it names, and must keep naming:

| | |
|---|---|
| Repository | `oleksandrdubyna88/dew_flow_vscode_kit` — `package.json`'s `repository.url`, which is also what links the package to the repository on GitHub |
| Workflow | `.github/workflows/release.yml`, started by `release` (`published`) |
| Ref | `refs/tags/v<version>` |
| Runner | GitHub-hosted (a self-hosted runner is refused) |

To check a version yourself, download the tarball (`npm pack @oleksandrdubyna88/vscode-webview-kit@<version>`
with the token set, as in "Use") and run:

```bash
gh attestation verify <tgz> --repo oleksandrdubyna88/dew_flow_vscode_kit \
  --cert-identity https://github.com/oleksandrdubyna88/dew_flow_vscode_kit/.github/workflows/release.yml@refs/tags/v<version> \
  --source-ref refs/tags/v<version> --deny-self-hosted-runners
```

or run `node scripts/verify-published.mjs <version>`, which does that against the tarball GitHub Packages
serves, reads gh's answer back (one entry must name that identity, ref and a GitHub-hosted runner, be SLSA v1
provenance, and have the served file as a subject), and also asserts the integrity and, with
`--check visibility`, that the package is public.

### What the owner creates once, before the first release

1. **The release App on this repository.** Install the `dew-flow-release-please` GitHub App on
   `oleksandrdubyna88/dew_flow_vscode_kit` (installing needs a browser). It writes with its own token:
   *Contents* and *Pull requests*, read and write — the permissions it already uses on the sibling
   repositories; check them on the App's settings page.
2. **Two repository Actions secrets** (Settings → Secrets and variables → Actions):
   `RELEASE_PLEASE_APP_ID` — the numeric App ID from <https://github.com/settings/apps/dew-flow-release-please>;
   `RELEASE_PLEASE_APP_PRIVATE_KEY` — the App's PEM, set from a file on stdin, never with `--body` (a
   multi-line value from a Windows shell arrives mangled): `gh secret set RELEASE_PLEASE_APP_PRIVATE_KEY -R
   oleksandrdubyna88/dew_flow_vscode_kit < key.pem` in Git Bash, or `Get-Content -Raw key.pem | gh secret set
   RELEASE_PLEASE_APP_PRIVATE_KEY -R oleksandrdubyna88/dew_flow_vscode_kit` in PowerShell. Until both exist,
   every run of `release-please.yml` fails with a message saying so, and nothing is proposed.
3. **The GitHub environment `npm`** (Settings → Environments → New environment, named exactly `npm`). It
   holds **no secret and no token** — the publish uses the job's own `GITHUB_TOKEN`. What it adds is a fence:
   - *Deployment branches and tags* → *Selected branches and tags* → a **tag** rule `v*`, and nothing else,
     so only a release tag's run can reach the publish job;
   - optionally, *Required reviewers*: the owner — a person approving each publish before it runs.
4. Recommended, as on the siblings: a tag ruleset that restricts creating, moving and deleting `v*` tags
   to the App — and a probe that it refuses, since reading a ruleset back is not evidence it acts.

### Package visibility — check it after 0.1.1

GitHub's documentation disagrees with itself. One page says a package a workflow creates with `GITHUB_TOKEN`
"inherits the visibility and permissions model of the repository where the workflow is run" — this
repository is public, so 0.1.1 should be public by itself. Another page says that when you first publish a
package its default visibility is private. So visibility is CHECKED, not assumed: item 4 of
[POST_DEPLOY.md](POST_DEPLOY.md) (`--check visibility`) fails when the package is not public.

If it is private, the owner makes one click: on the package page (github.com → this repository → *Packages* →
the package) → *Package settings* → *Danger Zone* → *Change visibility* → *Public*, and type the package name
to confirm. **It is irreversible** — GitHub does not let a public package become private again.

### When a publish fails

The tag and the GitHub release stay exactly where they are (plan §6, point 5). **A tag is never moved or
deleted**: a moved tag makes every checkout that already fetched it wrong in a way nothing reports, and
deleting the tag of a published release turns the release into a draft.

**Which re-run:** always **"Re-run failed jobs"**, never **"Re-run all jobs"** after a publish. Re-running
the failed jobs reuses the SAME artifact (kept 30 days, GitHub's re-run window), so nothing is re-packed,
and it re-runs the jobs that depend on the failed one, the consume job included. Re-running all jobs
re-packs, and may build other bytes; verify then refuses them.

- **The cause is outside the repository** (an environment rule, a missing permission, a registry outage) and
  the run stopped before the publish step: fix the setting and **re-run the failed jobs**. Same tag, same
  commit, nothing was published.
- **The cause is in the repository**: fix it on `main`; the next release-please pull request cuts the next
  patch and its tag publishes. A fix that lives only in `.github/` releases nothing by itself
  (`exclude-paths`), so the next patch is cut by the next commit that changes the package; a release tag
  runs the workflow file AT that tag, so the fix reaches the release it needs. Say in the next release's
  notes that the version before it never reached a registry.
- **The publish succeeded and a later step failed**: **re-run the failed jobs.** `publish-once.mjs` asks GitHub
  Packages first; the version is already served, so it publishes nothing, says so, and the verify step then
  reads what is served. If it is this run's attested bytes the run goes green; the attestation and the
  consume step still run.
- **The verify step fails because the served bytes are not the attested bytes** (the sha512 of the served
  tarball is not the one the job packed, or the attestation is for other bytes or another identity): that is
  a **bad release**, not a flake. Do not re-run it into green; fix forward (below).

### Rolling back a bad version — fix forward, never delete

A published version is never published again: GitHub Packages, like npm, will not overwrite a version, so a
bad release is fixed forward — ship the fix as the next patch. A consumer rolls back by reverting its own
pin; every version ever published stays installable, so no kit version has to be rebuilt to go back to it.

To mark the bad version, `npm deprecate @oleksandrdubyna88/vscode-webview-kit@<bad> "<what is wrong>; use
<fixed>"` against the GitHub registry may work, but it is **not yet verified** to work on GitHub Packages
(it is checked at the first release). **Never delete a version** from the package page: it breaks every
lockfile that already resolved it (whether GitHub Packages lets the number be published again afterwards is
not verified, and is not a path this repository takes).

### npm trusted publishing — superseded 2026-10-16

The package no longer goes to npmjs, so there is no npm package to bind a trusted publisher to and nothing to
set up there. The attestation (above) gives the same who-built-it evidence — this repository, this workflow,
this tag, a GitHub-hosted runner — without any token. The reason for the switch: the 0.1.0 publish to npmjs
(run 38925094342) failed twice with E403, *"Two-factor authentication or granular access token with bypass
2fa enabled is required"*, and nothing reached any registry. The earlier plan to bind trusted publishing
after 0.1.0 is therefore struck.

## License

MIT
