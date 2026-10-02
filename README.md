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

`node scripts/pack-and-consume.mjs --published <version>` runs the same steps over the tarball npmjs
serves for that version — downloaded, never built — which is how a release is checked after it is public.

## Release and rollback

Releases are cut by [release-please](https://github.com/googleapis/release-please) and published to npm
by CI, with provenance. Nobody publishes from a laptop. **Nothing has been published yet**; the pipeline
below is in the repository and waits for the one-time setup at the end of this section.

### How a release happens

1. **Commits land on `main`** in the conventional shape. The commit TYPE is the version: `feat:` a minor,
   `fix:` / `perf:` a patch; `docs:`, `test:`, `ci:`, `chore:`, `refactor:`, `build:` release nothing. A
   commit that touches only `.github/` never releases, and the title check refuses a releasing title whose
   changes are documentation alone (`.github/scripts/docs-only-title.mjs`).
2. **`release-please.yml`** (every push to `main`) opens or updates one pull request, *chore(main): release
   x.y.z*, which bumps `package.json` and `package-lock.json` and writes `CHANGELOG.md`. It runs with the
   release App's token, so that pull request gets CI like any other.
3. **Merging it is the decision to release.** The run that merge starts tags `v<x.y.z>` (no component) and
   creates the published GitHub release. The first release is **0.1.0** (`initial-version`, with an empty
   manifest — see `$bootstrap` in `release-please-config.json`).
4. **`release.yml`** (started by that published release, and by nothing else):
   **guard** — the tag is exactly `v<major>.<minor>.<patch>`, the release was made by the App, it is not a
   draft or pre-release, its commit is on `main`, and `package.json` at the tag says the same version;
   **pack-and-consume** — the packed tarball installs, type-checks, bundles and runs in the consumer fixture
   on ubuntu and windows; **publish** — needs both, runs in the GitHub environment `npm`, re-checks the
   guard, runs `npm ci` and `npm test`, `npm publish --provenance --access public`, then verifies what
   npmjs serves (`scripts/verify-published.mjs`) and runs the consumer fixture against the published
   tarball.
5. **Afterwards**, from a checkout of the tag, run [POST_DEPLOY.md](POST_DEPLOY.md) and stamp it:

   ```bash
   node .agents/conventions/tools/post-deploy-check.mjs --target 0.1.0 --timeout 300000
   ```

Consumers pin the EXACT version and switch in their own pull requests, only after a version is on npm and
verified.

### The provenance identity

Every version is published with a SLSA v1 provenance statement, signed through GitHub's OIDC issuer, that
names where it was built. For this package that is, and must stay:

| | |
|---|---|
| Repository | `oleksandrdubyna88/dew_flow_vscode_kit` — `package.json`'s `repository.url`, which npm checks against the statement |
| Workflow | `.github/workflows/release.yml`, started by `release` (`published`) |
| Ref | `refs/tags/v<version>` |
| Environment | `npm` — the GitHub environment the publish job runs in; it is not written into the statement, and it is what npm trusted publishing will be bound to |

To check a version yourself: `npm audit signatures` in a project that installed it, or
`node scripts/verify-published.mjs <version>`, which also asserts the statement's repository, workflow and
ref and that it is about the exact tarball npmjs serves (its sha512 against `dist.integrity`).

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
3. **The GitHub environment `npm`** (Settings → Environments → New environment, named exactly `npm`):
   - an **environment** secret `NPM_TOKEN` — a repository secret of that name is NOT what the publish job
     reads, and with no environment secret the job fails at its first step;
   - *Deployment branches and tags* → *Selected branches and tags* → a **tag** rule `v*`, so only a release
     tag's run can reach the secret;
   - optionally, *Required reviewers*: the owner — a person approving each publish before it runs.
4. **The npm token** for `NPM_TOKEN`: on npmjs.com, logged in as the account that owns the
   `@oleksandrdubyna88` scope, a **granular access token** (not a classic one) with *Packages and scopes*:
   *Read and write*. The package does not exist yet, so the token cannot be narrowed to it: choose all
   packages (or the scope, where offered), no organizations, and the shortest expiry that covers the first
   release. Where the account requires two-factor authentication to publish, the token needs npm's *bypass
   2FA* setting, or CI fails with `EOTP`. It exists to publish 0.1.0 and is retired right after (below).
5. Recommended, as on the siblings: a tag ruleset that restricts creating, moving and deleting `v*` tags
   to the App — and a probe that it refuses, since reading a ruleset back is not evidence it acts.

### When a publish fails

The tag and the GitHub release stay exactly where they are, and nothing is on npm (plan §6, point 5).
**A tag is never moved or deleted**: a moved tag makes every checkout that already fetched it wrong in a
way nothing reports, and deleting the tag of a published release turns the release into a draft.

- **The cause is outside the repository** (no `NPM_TOKEN`, an environment rule, a registry outage) and the
  run stopped before `npm publish`: fix the setting and **re-run that run**. Same tag, same commit, nothing
  was published.
- **The cause is in the repository**: fix it on `main`; the next release-please pull request cuts the next
  patch and its tag publishes. A fix that lives only in `.github/` releases nothing by itself
  (`exclude-paths`), so the next patch is cut by the next commit that changes the package; a release tag
  runs the workflow file AT that tag, so the fix reaches the release it needs. Say in the next release's
  notes that the version before it never reached npm.
- **`npm publish` succeeded and a later step failed**: the version is public. Re-running fails closed (npm
  refuses to publish over a version), so check it by hand with `POST_DEPLOY.md` and treat what it finds as
  a bad release, below.

### Rolling back a bad version — deprecate, never unpublish

npm versions are immutable and a number is never reused, so a bad release is fixed forward: ship the fix
as the next patch, then, from the owner's machine,

```bash
npm deprecate @oleksandrdubyna88/vscode-webview-kit@<bad> "<what is wrong>; use <fixed>"
```

**Never `npm unpublish`**: it breaks every lockfile that already resolved the version, and the number can
never be published again anyway. A consumer rolls back by reverting its own pin — every version ever
published stays installable from the registry, so no kit version has to be rebuilt to go back to it.

### After 0.1.0: npm trusted publishing, and the token retired

Trusted publishing is configured per package, so it can be bound only once the package exists:

1. npmjs.com → the package → *Settings* → *Trusted publisher* → GitHub Actions: user `oleksandrdubyna88`,
   repository `dew_flow_vscode_kit`, workflow `release.yml`, environment `npm` — the identity above.
2. In `release.yml`: drop `NODE_AUTH_TOKEN` from the publish step and the `NPM_TOKEN` check, and publish
   with an npm new enough for trusted publishing (npm documents 11.5.1 or later; the Node 22 runner's npm is
   10). Provenance is then produced by trusted publishing itself.
3. Set the package's publishing access to require two-factor authentication and disallow tokens, delete
   `NPM_TOKEN` from the `npm` environment, and revoke the token on npmjs.com.

This is tracked as part B of the plan's Definition of Done and is not done yet.

## License

MIT
