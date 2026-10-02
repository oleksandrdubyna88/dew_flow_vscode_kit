# Architecture — dew_flow_vscode_kit

> Being built along [../todo/PLAN_extract_the_kit.md](../todo/PLAN_extract_the_kit.md): epic 1 (the
> machinery and the pure modules) and epic 2 (the display host, the help catalog, and the help page and
> panel) have landed; the release pipeline (epic 3) has not, so nothing is published yet. This file
> describes what exists and is rewritten as each module lands.

## What this package is

`@oleksandrdubyna88/vscode-webview-kit`: the webview building blocks two VS Code extensions share instead
of copying. Pure modules render strings from values and are tested as functions; page scripts are
strings a webview runs and are tested by RUNNING them; the few host modules take a narrow port instead
of the `vscode` namespace and are tested with a fake stricter than the real API. Nothing in `src/`
imports `vscode` — `src/test/architecture.test.ts` fails the build if a pure module does, and the only
`node:` import outside the tests is `src/webview/nonce.ts` (`node:crypto`). Since E2.S3 the same test also
walks run-time import CLOSURES: no module a page is rendered by may reach `nonce.ts` even one hop away,
while the help panel — the host half that mints a nonce per render — must.

## Module map

| Module | Files | Status |
|---|---|---|
| `text` | `asText.ts` | landed (E1.S2) |
| `webview` | `escape.ts` (`escapeHtml`, `escapeHtmlForHighlighting`, `jsonForScript`), `nonce.ts`, `writeQueue.ts`; `posted.ts` — a posted message read as own members only, shared by both message readers; `hooks.ts` (`hookAll`, internal) — a constructor's hooks made all or none | landed (E1.S2; `posted.ts` E2.S3; `hooks.ts` epic 2 code round) |
| `settings` | `settingWritten.ts` — the "a view setting could not be saved" reporter, consumer funnel injected | landed (E1.S2) |
| `display` — pure halves | `config.ts` (`createDisplayConfig`, prefix validation), `zoom.ts`, `tone.ts`, `messages.ts` | landed (E1.S3; `messages.ts` E2.S1) |
| `display` — host | `port.ts` (`ConfigurationPort`, `WebviewPort`), `press.ts` (`readPress`), `host.ts` (`createDisplayHost`) | landed (E2.S1) |
| `help` — catalog | `types.ts`, `sha256.ts`, `digest.ts` (`digestOf`), `catalog.ts` (`createCatalog`, `bodyFor`), `bootstrap.ts` (`stampTranslations`), `coverage.ts` (`staleTranslations`, `everyArticleInEveryLanguage`) | landed (E2.S2) |
| `help` — page, panel | `page.ts` (`renderHelpPage`, `searchIndex`, `articleHtml`, `helpCsp`), `pageText.ts` (chrome, section labels, `bodyHtml`, the notes), `pageScript.ts` (the one `<script>`), `messages.ts` (`readHelpMessage`), `panel.ts` (`createHelpPanel`, `HelpPanelPort`) | landed (E2.S3) |
| package entry | `src/index.ts` — the whole 0.1.0 API: `display`, `settings`, `text`, `webview`, the help catalog, page, message reader and panel; pinned name by name by `src/test/exports.test.ts` | landed (E2.S3) |
| bin | `scripts/help-digests.mjs`, shipped as `vscode-webview-kit-help-digests` (`package.json` `bin` and `files`) | landed (E2.S2; shipped E2.S3) |

## The display module

Two controls every page carries — ± text size (`uiScale`) and ± text tone (`textTone`) — each a GLOBAL
setting so a vision preference follows the person to their next machine. The page reports which way a
button was pressed and never the result; the host clamps, writes once, and the setting's change event
repaints every open page from the one stored value. Two open pages never show two sizes, because there is
no per-page state to disagree.

```mermaid
flowchart TB
  subgraph webview["Webview page — zoomScript / toneScript, RUN by the tests"]
    buttons["± buttons"]
    repaint["repaint on a uiScale / textTone message"]
  end
  subgraph consumer["Consumer extension — the only code that imports vscode"]
    panel["panel.webview.onDidReceiveMessage"]
    ports["adapters: ConfigurationPort, WebviewPort"]
  end
  subgraph kit["Kit — src/display, no vscode import"]
    readPress["readPress: known type, finite delta reduced to one step, field absent or empty"]
    host["createDisplayHost: clamp, one write per press, registry of attached pages, listeners made all or none"]
    queues["WriteQueue, one per setting"]
    messages["uiScaleMessage / textToneMessage"]
  end
  failed["reporterFailed, default console.error"]
  buttons -- "postMessage: type, delta, field" --> panel
  panel -- "host.press(message, source)" --> readPress
  readPress -- "Press, or a typed rejection" --> host
  host --> queues
  queues -- "write(setting, clamped value) at user scope" --> ports
  ports -- "onDidChange(setting)" --> host
  host --> messages
  messages -- "to every ATTACHED page; false or a rejection: report and detach" --> ports
  ports -- "postMessage" --> repaint
  host -- "a reporter or page dispose hook that throws at the detached edge of a push" --> failed
```

**The trust boundary** is `press.ts`. A message is read as own properties only; it must carry `type`
`zoom` or `tone`, a `delta` that is a finite number (truncated, then one step in its direction — below a
whole step is no press and no write), and a `field` that is absent or `''`. Everything else comes back as
`{ accepted: false, reason }` — `not-an-object`, `unknown-type`, `delta-not-a-number`, `no-step`, `field`
— and `readPress` never throws. ConnectOtherAIs at `1056aed9` had this rule in three parsers that
disagreed on a sub-step delta; the kit keeps the unified one (`textControlFrom`).

**The ports** (`port.ts`) are the subset of `vscode` the two coai host modules used, shaped so a consumer's
adapter is a few lines: `ConfigurationPort` reads a setting raw, writes it to the user scope (a
`PromiseLike`, so `WorkspaceConfiguration.update`'s thenable passes straight through) and watches it;
`WebviewPort` posts a `DisplayMessage` and exposes the PANEL's dispose event, which a `vscode.Webview`
itself does not carry.

**The host** (`host.ts`, finding 1 of the epic 2 plan round) keeps a registry: `attach(webview)` pushes both
current values at once, returns a disposable, and is also undone by the page's dispose event; a change
pushes only the changed setting's message, to attached pages only; a `postMessage` that resolves `false`
or rejects is caught, reported through `DisplayReporter.pushNotDelivered`, and detaches that page; a push
never runs inside the write queue, so a page that never answers cannot block a write. A failed write is
reported once through `settingWritten` with the consumer's `settingNotSaved` funnel. `dispose()` unhooks
both setting listeners and every page; `attach`, `press` and `apply` after it throw synchronously, and a
press still queued behind a write in flight is dropped when the queue reaches it — the in-flight write
lands, nothing after it does (gate, epic 2 code round, finding 0).

**Lifetime edges** (same round, findings 2 and 4). The two setting listeners are made all or none through
`webview/hooks.ts`'s `hookAll`: a registration that throws undoes the ones before it, newest first, before
its error is rethrown — the help panel's four hooks are made the same way. A push is a detached execution
whose outermost frame catches everything: a `pushNotDelivered` that throws (the page is already detached)
or a page dispose hook that throws goes to the optional `DisplayHostOptions.reporterFailed`, which
defaults to `console.error` — a global, so no `node:` import — and one that throws itself is logged to
`console.error` with both errors. The promise a push leaves behind never rejects.

**Byte-compatibility.** For coai's configuration (`ConnectOtherAIs`, prefix `coai`, section `coai`) the
markup, scripts, CSS, pushed messages and written values equal what coai's own modules produced at
`1056aed9`. The expected values are RECORDED from those modules by `scripts/record-coai-display.mjs` —
the host halves through a typed `vscode` stub — into `src/test/fixtures/coai-display-1056aed9.json`,
never retyped.

**Growth** (plan §5): one write queue per setting, as long as the presses not yet written; one attachment
per open page, each leaving on dispose, detach or a failed push. No files, no caches.

## The help module — the catalog half (E2.S2)

The help page reads one catalog: the consumer's articles (English, in index order) and one translation
module per language. `createCatalog` checks that input once; `bodyFor(catalog, article, language)` answers
`{ body, fallback, stale }`. The page and the panel that render it are E2.S3.

```mermaid
flowchart TB
  subgraph consumer["Consumer extension — owns the content"]
    articles["articles: id plus the English body"]
    modules["one translation module per language: bodies and from"]
    ci["its own test: staleTranslations and everyArticleInEveryLanguage asserted empty"]
  end
  subgraph kit["Kit — src/help, pure, no vscode and no node: import"]
    create["createCatalog: validate once, derive the languages"]
    catalog["Catalog: languages, articles, translations"]
    bodyFor["bodyFor: body, fallback, stale"]
    digest["digestOf: six fields joined by U+0000, UTF-8, SHA-256, first 8 hex"]
    sha["sha256.ts: FIPS 180-4, pure TypeScript"]
    coverage["coverage.ts: staleTranslations, everyArticleInEveryLanguage"]
    stamp["stampTranslations: the one-time bootstrap"]
  end
  script["scripts/help-digests.mjs: prints each stale or unknown pair with its replacement from line"]
  articles --> create
  modules --> create
  create --> catalog
  catalog --> bodyFor
  bodyFor -- "from against the current English digest" --> digest
  digest --> sha
  catalog --> coverage
  coverage -- "decides through bodyFor" --> bodyFor
  catalog --> stamp
  stamp -- "from maps pasted once" --> modules
  coverage --> ci
  catalog --> script
  script -- "lines pasted after a re-check" --> modules
```

**`body` and `fallback` are coai's.** For an article in English, the English body; in another language,
that module's own body, or English with `fallback: true` when it has none. The answers are held against
ConnectOtherAIs' own `bodyFor`, RECORDED by `scripts/record-coai-help.mjs` from coai's `helpContent.ts` at
`1056aed9` — over small partial translation modules written by the recorder, and over coai's real id
coverage (33 articles, four modules) — into `src/test/fixtures/coai-help-1056aed9.json`. One deviation, with
the evidence in the recording: coai looked a body up through the prototype, so an article whose id is a
key of `Object.prototype` (`constructor`) got the Object function back as its "translation"; the kit reads
own properties only and answers the English fallback.

**`stale` is the kit's.** Each translation module is `{ bodies, from }`: `from` maps an article id to the
digest of the English body it was translated from. `fresh` when that equals the current English digest
(and always for English itself and for a fallback, which ARE the current English), `stale` when it
differs, `unknown` when the module records no `from` for a body it has — never assumed fresh.

**The digest** (`digest.ts`, plan §2): the six fields in the fixed order `title`, `whatItIs`, `why`,
`setup`, `usage`, `whatCanGoWrong`, joined with U+0000, UTF-8, no other normalisation — a CR, a trailing
space, a decomposed accent are each an edit of the English — then the first 8 hex characters of SHA-256.
32 bits is a change detector, never an integrity check.

**Why SHA-256 is pure TypeScript here and not `node:crypto`.** `bodyFor` is on the path of the PURE page
module (E2.S3 renders the stale note from it), and `architecture.test.ts` scans each file for `vscode` /
`node:` imports — a host-only `digest.ts` would have made `catalog.ts`, and through it the page, host-bound
by import while every per-file scan stayed green. Web Crypto's `subtle.digest` is asynchronous and would
make `bodyFor` a promise. So `sha256.ts` is a plain FIPS 180-4 implementation (~100 lines), used for change
detection only, pinned by the standard's five vectors and a differential run against `node:crypto` over
every length 0–200 and 300 seeded random strings (lone surrogates included). The host allowlist did not
grow: the only `node:` import outside the tests is still `src/webview/nonce.ts`.

**The boundary.** `createCatalog` refuses, with a `TypeError` naming what, where and what would be
accepted: no articles; an empty or repeated id; a body missing any of the six fields (English or
translated); a module for a language the help does not have (or for `en`); a translated body for an article
the catalog does not have; a `from` entry with no body beside it; a `from` that is not 8 lowercase hex. The
languages are derived — English, then each language with a module, in `HELP_LANGUAGES` order. Input is
never written, and never held (gate, epic 2 code round, finding 5): every article, body, translation and
`from` map is COPIED first — a body as its six fields, each read once — and the copy is what is checked,
frozen all the way down and kept, so an edit to the input after `createCatalog` changes nothing `bodyFor`
or the page shows. The translated-body check looks ids up in a `Set` made once per catalog, and a page
render walks `catalog.articles` once rather than finding each article by id (findings 6 and 7).

**What a consumer's CI asserts** (epic 2 plan round, finding 0). `staleTranslations(catalog)` lists every
translated body that is `stale` or `unknown` as `{ article, language, stale, from, current }` (`from` is
`null` when unknown), in article then language order; a consumer asserts it empty, so an English edit
committed without its translations fails that consumer's build rather than reaching a reader.
`everyArticleInEveryLanguage(catalog)` is coai's "every article exists in every language" check, as
`{ complete, missing }`. Both decide through `bodyFor`, so neither can disagree with what a reader sees.

**The bootstrap and the script.** `stampTranslations(catalog)` returns new modules with every body's `from`
stamped to today's English digest — run ONCE at a consumer's switch, on the stated assumption that its
shipped translations match today's English, and the result pasted into its modules; run on every build it
would switch stale detection off. After a deliberate re-translation, `scripts/help-digests.mjs <compiled
catalog module> [--export name] [--kit entry]` re-makes the catalog with the kit's own `createCatalog`,
prints exactly `staleTranslations`' pairs grouped by language with the replacement `from` line for each,
and exits 1 (0 when nothing is stale, 2 on a usage, load or validation error). Since E2.S3 it ships:
`package.json` lists it in `files` and as the bin `vscode-webview-kit-help-digests`, and its default
`--kit` is the package's own `dist/index.js` resolved from the script's location (`import.meta.url`),
never from the cwd — so the installed bin uses the kit it was installed with.

**Growth:** none. The catalog is made once from the consumer's constants; nothing is cached or kept.

## The help module — the page and the panel (E2.S3)

The page is PURE: `renderHelpPage({ catalog, language, display, nonce, uiScale?, textTone?, appendix? })`
returns the whole HTML document as a string, and every input is handed in — the nonce included, which the
host mints per render. The panel is the HOST half, behind a fourth port, `HelpPanelPort`: the consumer
creates the `WebviewPanel` (that needs `vscode.window`) and adapts it in four lines.

```mermaid
flowchart TB
  subgraph consumer["Consumer extension — the only code that imports vscode"]
    wv["vscode.WebviewPanel"]
    port["HelpPanelPort adapter: setHtml, postMessage, onDidReceiveMessage, onDidDispose"]
    cfg["ConfigurationPort adapter"]
    dhost["its ONE display host"]
  end
  subgraph kit["Kit — src/help, no vscode import"]
    panel["createHelpPanel: render on open and on a language change; four hooks made all or none; dispose unhooks all"]
    read["readHelpMessage: a press, or a language the catalog offers; anything else refused with a reason"]
    page["renderHelpPage: pure, nonce injected, CSP, index, articles, notes, appendix"]
    script["pageScript: the one script under the nonce: routing, search, language select"]
    nonce["webview/nonce: 16 random bytes per render, host-only"]
    queue["WriteQueue for the language setting"]
  end
  wv --- port
  port -- "message the page posted" --> panel
  panel --> read
  read -- "press" --> dhost
  read -- "language" --> queue
  queue -- "write helpLanguage at user scope" --> cfg
  cfg -- "onDidChange helpLanguage" --> panel
  panel -- "render" --> page
  nonce -- "nonce" --> panel
  page --> script
  panel -- "setHtml" --> port
  dhost -- "uiScale / textTone pushed live" --> port
```

**Byte-compatibility.** For coai's configuration (`ConnectOtherAIs`, prefix `coai`), the same nonce and the
same appendix, `renderHelpPage` returns the bytes coai's `renderHelpHtml` returned at `1056aed9` — for every
language, at the theme's own size and tone and at two off-centre pairs — and `searchIndex`, `articleHtml`
and `bodyHtml` equal coai's for every recorded input. The pages are RECORDED from coai's real `helpPage.ts`
by `scripts/record-coai-help-page.mjs` into `src/test/fixtures/coai-help-page-1056aed9.json`: coai's engine,
escapers and display controls compiled as they are, its `HELP_ARTICLES` export reassigned to small
synthetic articles (recorded as input), its four translation modules and `helpPrompts.ts` replaced by small
files, and the nonce read back from each page it rendered. coai's appendix — the private `promptsHtml()` it
put inside the `prompts-in-full` article — is recovered from coai's own output as the difference between that
article and a twin with the same body under another id, and the recorder refuses unless both renders
reassemble from it. A consumer's appendix is its own escaped markup, inserted as is.

**The CSP and what is checked at the door.** The policy is coai's, byte for byte:
`default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-…';`. `default-src 'none'` means no image,
font, frame, connection or form reaches anywhere; scripts run only under the per-render nonce, and the page
has exactly one script and no inline handler. `style-src 'unsafe-inline'` is kept because the page's own
`<style>` carries only the kit's constants and two clamped numbers — never a consumer's or a reader's text —
and dropping it would break byte-compatibility for no gain. Two inputs reach an attribute unescaped and are
therefore checked: the nonce must be at least 22 base64 characters (128 bits, the CSP specification's
floor; what `nonce()` mints passes), and the language must be one of `catalog.languages`. Article text is
escaped before any markup of ours is added; data reaches the script only through `jsonForScript`, which
`src/test/scriptInterpolation.test.ts` enforces by scanning every shipped source for an interpolated
`JSON.stringify`.

**What the kit adds to coai's page.** The language switch lists `catalog.languages` — English and the
languages with a module (all five for coai) — instead of all five unconditionally. A translation `bodyFor`
answers as `stale` or `unknown` carries a note where the fallback note goes, in the help's language
(`<p class="fallback stale">`, so the stylesheet is unchanged); a fresh catalog renders no note at all, which
is what keeps coai's bootstrapped catalog byte-identical. A fallback is never stale: it IS the current
English.

**The trust boundary, help side** (`messages.ts`). `readHelpMessage(message, catalog.languages)` reads own
members only (`webview/posted.ts`, shared with `display/press.ts` so the rule lives once), hands `zoom` /
`tone` to `readPress` unchanged, and accepts `language` only as a string the catalog offers with a `field`
absent or empty. Everything else comes back as `{ accepted: false, reason }` — `not-an-object`,
`unknown-type`, `language-not-offered`, `field`, or a press reason — and the reader never throws. coai checked
the language against all five and ignored other types silently; the kit narrows the first and names the second.

**The panel** (`panel.ts`). `createHelpPanel` renders first, then makes four hooks: the display attachment
(the consumer's display host pushes size and tone to this page like any other), the language setting's
change listener (re-render), the port's message listener, and the port's dispose event — all or none
through `hookAll`, so a later registration that throws detaches the display attachment and releases the
earlier listeners before its error is rethrown (gate, epic 2 code round, finding 3). A press goes to
`display.apply`, which writes once and pushes the new value live — a size change never re-renders, so the
reader keeps their place; a language goes through the panel's own `WriteQueue` and `settingWritten` with the
consumer's `settingNotSaved` funnel, naming `help`. The stored language reads as English when it is junk or
a language the catalog has no module for. `dispose()` — or the panel closing — unhooks all four and leaves
the consumer's display host alone; `render` and `handle` throw afterwards, and a language write already in flight still lands while a choice still queued behind it is dropped — the display host's rule.

**Growth** (plan §5): one panel holds four hooks and one write queue as long as the language writes not yet
done; a closed panel holds nothing.

## The test harness

See [module_tests.md](module_tests.md): the page-script sandbox, the strict display fakes, the flow
catalogue, and what the suite does not prove.

## Repository machinery

- `package.json` (`@oleksandrdubyna88/vscode-webview-kit` 0.1.0, CommonJS, `main`/`types`/`exports` into
  `dist/`, `files: ["dist", "scripts/help-digests.mjs"]`, the bin `vscode-webview-kit-help-digests`, no
  `dependencies`), `tsconfig.json` (coai's strict set, ES2022 without DOM,
  `noEmitOnError`), `tsconfig.build.json` (declarations into `dist/`, tests excluded), `eslint.config.mjs`
  (type-aware, `complexity 4` / `max-lines-per-function 50` on `src/**`, `linebreak-style unix`),
  `scripts/run-tests.mjs` (readdir discovery, `node --test`), `scripts/clean.mjs`, the three coai
  recorders `scripts/record-coai-display.mjs`, `scripts/record-coai-help.mjs` and
  `scripts/record-coai-help-page.mjs` over their shared `scripts/coai-modules.mjs` (extract coai sources at a
  ref, compile them with this repository's `@types` — coai's `helpPage.ts` imports `node:crypto` — and load
  them), and `scripts/help-digests.mjs`.
- **CI:** `.github/workflows/ci.yml` runs the whole chain — conventions check, plan lifecycle, typecheck,
  lint, test, build, `npm pack --dry-run` — on `ubuntu-latest` AND `windows-latest`, every action pinned to a
  commit SHA; `pr-title.yml`, `coderabbit-review.yml` + `.coderabbit.yaml`, `dependabot.yml`.
- The family rules, mounted at `.agents/conventions` (tracking `release`), and the Claude host adapter
  (`.claude/settings.json`, `.claude/hooks/`).

## Consumers (cross-repository)

| Repository | Uses | Since |
|---|---|---|
| `dew_flow_connect_other_ais` | the source of the extracted modules (`src_vs_code/src` at `1056aed9`); switches to the package in its own PR, adapting `vscode.workspace` and each panel to the ports (`ConfigurationPort`, `WebviewPort`, `HelpPanelPort` for the help panel) and passing its prompt listing as the help page's appendix | planned |
| `wsl_care` | the help page and display controls of its extension | planned |
