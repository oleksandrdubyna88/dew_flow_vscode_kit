# module_tests — the harness, the flows it drives, and what it does not prove

> Adopted 2026-10-02 with no product code yet; a flow is `not covered` until its module lands. As of E2.S3
> every module of epics 1 and 2 has landed and every flow below is covered; the pack-install-bundle flow is
> E3.S1's.

## Where the harness is and how it runs

`src/test/` beside the sources, compiled with them by `npm run compile` (tsc → `out/`; `tsconfig.build.json`
keeps it out of `dist/`) and run by `npm test`: `scripts/run-tests.mjs` reads `out/test/` and hands every
`*.test.js` to `node --test` — a readdir, no glob, no shell. CI runs the same command on `ubuntu-latest`
and `windows-latest`, after `git config --global core.autocrlf false`.

The helpers the tests share:

- `src/test/pageHarness.ts` (E1.S1; widened E2.S3) — RUNS a page script in a `node:vm` context whose
  globals are an explicit allowlist (`document`, `window`, `acquireVsCodeApi`), under a 5 s deadline that
  also covers every click, event, key and message the test dispatches afterwards. Stricter than a browser:
  `querySelector` / `getElementById` answer `null` on a miss, a node the page was never handed cannot be
  clicked or fired, selectors are `[data-x]` / `[data-x="y"]` optionally behind a tag name and any other
  shape is REFUSED, and what the page posts must be structured-cloneable. E2.S3 added what the help page
  needs: an event fired on a node BUBBLES through its `under()` ancestors before the document's listeners
  (the page listens on the whole index and finds the item with `closest`), `fire(kind, init)` for `input` /
  `change`, a node's own `value`, `querySelectorAll` / `querySelector` on a node over its descendants in
  document order, `page.keydown(key)` to the document, `window.scrollTo` recorded, and every node reachable
  through `under()` from one the test handed in is wired to the page.
- `src/test/lineEndings.ts` (E1.S1) — `assertNoCr(text, what)`, failing with the index of the first CR, so
  a rendered fragment cannot pass on one platform and fail on the other.
- `src/test/coaiFixture.ts` (E2.S1, E2.S2) — the one reader of the coai recordings:
  `src/test/fixtures/coai-display-1056aed9.json`, which `scripts/record-coai-display.mjs` writes from
  ConnectOtherAIs' own modules at `1056aed9` (the pure halves directly; the host halves through a typed
  `vscode` stub), `src/test/fixtures/coai-help-1056aed9.json`, which `scripts/record-coai-help.mjs`
  writes from coai's own `helpContent.ts` (over partial translation modules it writes, and over coai's own
  four), and `src/test/fixtures/coai-help-page-1056aed9.json` (E2.S3), which
  `scripts/record-coai-help-page.mjs` writes from coai's own `helpPage.ts`: seven whole pages (every language,
  plus two off-centre size/tone pairs) with the nonce read back from each, the search index and every
  article's markup per language, `bodyHtml` over fifty samples, and coai's appendix recovered from its own
  output — over synthetic articles and partial modules recorded as input. Nothing in any of them is retyped.
- `src/test/fixtures/helpDigestsCatalog.ts` (E2.S2) — a consumer's catalog module as `help-digests`
  loads one: a stale, an unknown and a fresh translation (`catalog`), an all-fresh one (`freshCatalog`),
  and an invalid input (`brokenInput`); every `from` read back from `digestOf`.
- `src/test/fakeDisplayPorts.ts` (E2.S1) — strict fakes of the display host's two ports.
  `FakeConfiguration` refuses, by name, any setting the test did not declare; records every applied
  write; can hold writes pending (all, or one setting's) and release them, fail the next write with a
  reason, and change a setting from "outside"; counts live listeners. `FakeWebview` records every post as
  a structured clone, answers as told (`delivered` / `refused` / `rejects` / `hangs`), counts AND throws
  on a post after `dispose()`, and counts live dispose listeners. Both have their own contract tests.
- `src/test/fakeHelpPanelPort.ts` (E2.S3) — the strict fake of `HelpPanelPort`: `FakeWebview` underneath,
  plus every HTML it was given in order, and `receive(message)` that hands each message listener its own
  structured clone (an inherited member never arrives, a function cannot be sent). Setting HTML, adding a
  listener or receiving a message after dispose FAILS, and a message that arrives while nobody listens
  FAILS rather than vanishing — the real API would drop it silently. Its own contract tests are
  `src/test/fakeHelpPanelPort.test.ts`.

`src/test/architecture.test.ts` scans every pure module — everything under `src/` outside `src/test/` and
the host allowlist (`src/webview/nonce.ts`) — for `vscode` / `node:` imports and fails naming `file:line`;
a companion test proves the scan finds all four import shapes in a fixture, so it cannot pass vacuously.
The display host, its ports and the press validator are pure by this scan, and so is the whole help
catalog — `sha256.ts` included, which is why SHA-256 is TypeScript here (see `architecture.md`): the
allowlist did not grow. E2.S3 adds the one-hop view a per-file scan cannot have: the run-time import
CLOSURE of every module a page is rendered by (`help/page.ts`, `help/messages.ts`, `display/zoom.ts`,
`display/tone.ts`, `display/press.ts`) must not reach a host module, while `help/panel.ts`'s and
`src/index.ts`'s must reach `webview/nonce.ts` — the known instance that keeps the walk honest — and the
import reader itself is pinned on a fixture (multi-line, `export … from`, `../`, type-only skipped).

`src/test/scriptInterpolation.test.ts` (E2.S3) is the control for `typescript.doctrine` § 1: every shipped
source is scanned for `${JSON.stringify(` and fails naming `file:line`; the two error messages that quote a
value that way are allowlisted by their EXACT line, a companion test fails when an allowlisted line moves,
and a third proves the pattern matches every spelling in a fixture.

## Flow catalogue

| Flow | Covered | By |
|---|---|---|
| A page script runs under the harness: a press posts through `acquireVsCodeApi`, a pushed message repaints, an undeclared global is a `ReferenceError`, an infinite loop fails by the deadline | covered | `src/test/harness.test.ts` |
| No pure module imports `vscode` or a `node:` API | covered | `src/test/architecture.test.ts` |
| **The harness, widened for the help page** (E2.S3): a click or fired event runs the element's listeners, then each ancestor's, then the document's; `fire` runs only listeners of its kind and passes `init`; `keydown` reaches the document's keydown listeners; `scrollTo` is recorded; `querySelectorAll` on a node finds deep descendants in document order; a tag in a selector must match | covered | `src/test/harness.test.ts` — red first against a cut that stopped at the element, searched direct children only and ignored the tag: 4 of 19 red (`'list: quick-start at UL'` and `'row saw abc'` never posted; `'beta'` not found two levels down; `closest('li[data-nav]')` answered the `<a>`) |
| **The help page is byte-identical to coai's** for coai's config, the same nonce and the same appendix: seven whole pages (every language; size/tone 2/−1 and −5/5), the search index and every article's markup per language, `bodyHtml` over every recorded sample (a CRLF body folded as coai folded it) — each also CR-free | covered | `src/test/helpPage.test.ts` against `coai-help-page-1056aed9.json` (it is the compatibility half, so it passed against the straight port). Teeth: `padding: 16px 24px` → `25px` in the stylesheet turns 8 red; `shown > 0` → `shown > 1` in the page script turns 10 red (the 7 pages, the comparison test, and two script runs); routing every note through the stale branch turns 15 red; each file restored byte-identical, checked by SHA-256 |
| **The comparison depends on its inputs**: another nonce, another appendix, another display config each give another page; an unknown article id renders nothing | covered | `src/test/helpPage.test.ts` |
| **CSP and the door**: one `default-src 'none'` policy with the nonce on the page's one script, no inline handler, no `javascript:`; a nonce shorter than 22 base64 characters (or carrying a quote, a space, `<`, `;`) is refused; standard base64 with padding and longer base64url are accepted | covered | `src/test/helpPage.test.ts` — red first against the unchecked port: 8 of 8 *Missing expected exception* |
| **Only the languages the catalog offers**: the switch lists English and the languages with a module, the shown one selected; a language the catalog does not offer is refused by the page, the index and an article, naming what it does offer | covered | `src/test/helpPage.test.ts` — red first against the port listing all five: the select was not `en` + `ru` (the assertion on its exact markup failed), and the refusals were *Missing expected exception* |
| **The stale note** (new): every language has one, distinct from its fallback note; a fresh catalog renders none anywhere — the guard on coai's byte-compatibility; an English edit puts it over exactly that article's translations, under the title; English and an English fallback never carry it; a translation with no `from` (`unknown`) carries it too; it reaches the page through the script's article markup, and the head and stylesheet are unchanged | covered | `src/test/helpPage.test.ts` — red first against the port without the stale branch: 3 red (the edit, `unknown`, the page). Teeth: rendering the note for `fresh`/`unknown` instead of `stale`/`unknown` turns 15 red, the byte-compat pages among them |
| **The help page script RUN** — taken from the rendered page: first paint posts nothing; an index click opens that article (its markup, the crumbs with its escaped title, Back shown, index and search hidden, scrolled to the top); the appendix is in the prompts article; Back, the Home crumb and Escape return (another key does not); an item whose id has no article does nothing; the search filters case-insensitively over title and body in the shown language and shows `noHits` when nothing matches; coming back re-applies the filter; the language select posts `{ type: 'language', language, field: '' }`; ± size and tone post their presses; pushed size and tone repaint; the crumbs are in the page's language | covered | `src/test/helpPageScript.test.ts` — the script is coai's byte for byte, so these passed on first run; their teeth are the `shown > 1` mutation above (search and back-filter tests red) |
| **The help page's messages are validated** (`readHelpMessage`): a language only as a string the catalog offers (not one the help merely knows, not `fr`, `RU`, an array, `constructor`, `__proto__`), with `field` absent or empty; a press by the display rule unchanged; an unknown type, a non-string type, an inherited type, `null`, primitives, arrays refused with a typed reason; an own `__proto__` from JSON is data; never a throw | covered | `src/test/helpMessages.test.ts` — one row per shape. Red first against a cut taking the language as posted: 7 of 24 rows red (`fr` accepted as `{ kind: 'language', language: 'fr' }`, `de` accepted where not offered, `RU`, `constructor`, `__proto__`, both `field` rows) |
| What the kit's own help page POSTS — a language, a size, a tone — is what the reader ACCEPTS (the one live check of a contract written on two sides) | covered | `src/test/helpMessages.test.ts` |
| **The help panel** with the strict fakes and the REAL display host: renders once on open in the stored language at the current size and tone, under a nonce the CSP and script share; that HTML is `renderHelpPage`'s for the same inputs; the HTML is set before the display host pushes, and a page that cannot render leaves nothing hooked; every render mints a new nonce; junk, a non-string, nothing, or a language without a module reads as English; an outside language change re-renders | covered | `src/test/helpPanel.test.ts` — red first against a straight port of coai's panel: a junk stored language threw `TypeError: This help catalog offers en, ru, uk, de, es; it cannot be shown in xx.` One more red was the TEST's (it looked for the appendix verbatim, but the article markup reaches the page as `jsonForScript` text with `<` as `<`); the assertion was corrected, the code was not changed for it. The order test was written after the code; teeth: attaching before rendering turns it red (`actual: [ 'uiScale', 'textTone', 'html' ]`) |
| **The panel acts only on what it should**: a chosen language is written once and re-renders; two quick choices land in order through the write queue; a language the catalog does not offer is NOT written; `fr`, `__proto__`, an array, a `field`, an unknown type, a non-numeric delta, an inherited type, `null`, primitives write nothing and re-render nothing; a ± press goes through the display host (clamped, written once, pushed to this page live, no re-render); a failed language write is reported once through `settingNotSaved` naming `help`, and the next write still runs | covered | `src/test/helpPanel.test.ts` — red first: `de` written where the catalog offered `en, ru` (`accepted: true` for `language: 'de'`). Teeth: validating against all five languages instead of `catalog.languages` turns that test red |
| **The panel's lifetime**: `dispose()` (twice) and the panel closing each unhook all four hooks — language listener, message listener, display attachment, dispose listener — and leave the consumer's display host serving other pages; nothing re-renders or is pushed after; `render` and `handle` throw after dispose; a pending write still lands | covered | `src/test/helpPanel.test.ts` — red first: the display attachment's dispose listener survived (`actual: 1, expected: 0`). Teeth: replacing the attachment's disposable with a no-op turns it red |
| The help panel's strict fake keeps its contract: HTML recorded in order, each listener handed its own clone, an inherited member never arrives, a function cannot be sent, a message with no listener fails, nothing after dispose | covered | `src/test/fakeHelpPanelPort.test.ts` |
| **The 0.1.0 API is exactly what `src/index.ts` exports**: the value names read from the compiled entry and the type names read from the index's export lists each equal an expected list; nothing internal (`Host`, `Panel`, `sha256Hex`, the chrome strings, the posted-message reader, …) leaks | covered | `src/test/exports.test.ts` — red first before the index was widened: 13 values and 9 types missing (`asText`, `nonce`, `WriteQueue`, `renderHelpPage`, `createHelpPanel`, …; `HelpPanelPort`, `HelpAppendix`, …) |
| **No page module reaches a host module, even one hop away**; the panel and the index do reach `nonce.ts`; the import reader is pinned on a fixture | covered | `src/test/architecture.test.ts` — teeth: an import of `nonce` added to `help/page.ts` turns the closure test red while the per-file scan stays green |
| **No `JSON.stringify` interpolated into a template literal** in any shipped source, beyond two error messages allowlisted by exact line | covered | `src/test/scriptInterpolation.test.ts` — teeth: routing the page script's `HOME` through `JSON.stringify` turns the scan red while every byte-compat test stays GREEN (the bytes are equal for these inputs), which is exactly the case only the scan can see |
| **`help-digests` reaches consumers**: the manifest names the bin `vscode-webview-kit-help-digests` → `scripts/help-digests.mjs` and lists it in `files`; `npm pack --dry-run` carries it and otherwise only `dist/`, the manifest, README and LICENSE; run from an installed layout with no `--kit` it uses that package's own `dist/` (exit 1 with the lines; exit 0 when fresh); it starts with a node shebang | covered | `src/test/packaging.test.ts` — red first before `package.json` changed: the bin was `undefined` and the pack lacked the script. Teeth: resolving the default kit from the cwd turns the installed-layout run red |
| **SHA-256** (`src/help/sha256.ts`, pure TypeScript) equals the standard: FIPS 180-2's five vectors (empty, `abc`, the 448- and 896-bit messages, one million `a`), and `node:crypto` at every length 0–200 bytes and over 300 seeded random strings (Cyrillic, emoji, NUL, lone surrogates) | covered | `src/test/sha256.test.ts` — red first against a stub answering 64 zeros: 7 of 8 red (`actual '0000…' expected 'e3b0c442…'`) |
| **The digest's canonical form** (plan §2): the six fields by name in the fixed order, joined with U+0000, UTF-8, no other normalisation, first 8 hex — two vector literals computed independently by `node:crypto` (`fb76c375`, and `eafba843` for a Cyrillic body); CRLF ≠ LF, a trailing space or newline and a decomposed accent each change it; moving a character across a field boundary changes it; extra properties do not; a missing field is refused by name; `isDigest` accepts 8 lowercase hex only | covered | `src/test/digest.test.ts` — red first against a first cut that normalised CRLF, trimmed and joined with no separator: 7 of 12 red (`'TitleWhat it is…'` for the canonical form; CRLF and LF both `1e500044`; a missing field threw `Cannot read properties of undefined`). Teeth: emptying the separator turns the two vectors, the canonical form and the boundary test red |
| For coai's content `bodyFor` answers coai's **body and `fallback`**: every answer coai's own `bodyFor` gave over partial modules (a missing body, an empty language), recorded by `scripts/record-coai-help.mjs`; the fallback matrix over coai's real coverage (33 articles × 5 languages); `HELP_LANGUAGES` and the labels | covered | `src/test/helpCatalog.test.ts` (passes against a straight port of coai's engine too — it is the compatibility half) |
| **Deviation:** an article id that is a key of `Object.prototype` (`constructor`) — coai answered the Object function as its translated body (recorded); the kit reads own properties only and falls back to English | covered | `src/test/helpCatalog.test.ts` — red first against coai's port. Teeth: a prototype lookup turns both own-property tests red |
| **`stale`**: `fresh` when `from` equals the current English digest; an English edit makes exactly that article `stale` in every language that has it, the others fresh; a body with no `from` is `unknown`; English and a fallback are always `fresh` | covered | `src/test/helpCatalog.test.ts` — red first against coai's port (`stale` always `fresh`: `actual 'fresh' expected 'unknown'`). Teeth: folding `unknown` into `fresh` turns 7 tests red across the catalog, coverage and script suites |
| **`createCatalog` refuses** a defective input with a message naming what and where: no articles, an empty or repeated id, a body missing a field (English or translated), a module for an unknown language or for `en`, a body for an article the catalog lacks, a `from` with no body, a `from` that is not a digest, a module with no `bodies` map; the fixture they start from is accepted; languages are derived (English + modules, switch order); input is never written and later changes to it do not reach the catalog | covered | `src/test/helpCatalog.test.ts` — red first: every refusal *Missing expected exception*; languages `['en','ru','uk','de','es']` for a catalog with three modules; the catalog shared the input's array |
| **The bootstrap**: `stampTranslations` stamps every translated body — and only those — with its current English digest, in article order; afterwards `staleTranslations` is empty and every `bodyFor` fresh; a stale `from` is overwritten (the stated assumption); new objects, input never written | covered | `src/test/helpCoverage.test.ts` — red first against a stub handing the modules back: `from` stayed `{}`, every body `unknown` |
| **The consumer's CI check**: `staleTranslations` lists exactly the stale and unknown pairs as `{ article, language, stale, from, current }` (`from: null` when unknown), article then language order, and never a missing body; `everyArticleInEveryLanguage` lists what an offered language does not translate, complete when nothing; over coai's recorded coverage it is complete and every coai translation is `unknown` until bootstrapped | covered | `src/test/helpCoverage.test.ts` — red first against stubs answering `[]` and `complete: true` |
| **`help-digests` RUN** (a child `node`, 10 s deadline) over a compiled catalog module: prints exactly `staleTranslations`' pairs grouped by language with the replacement `from` line each, exit 1; pasting those lines makes the catalog fresh; a fresh catalog prints one line, exit 0; no module, an absent export and an invalid catalog exit 2 on stderr | covered | `src/test/helpDigests.test.ts` — red first against an empty script (`actual ''`, exit 0 where 2 was expected) |
| The coai recorders share one extract-and-compile half (`scripts/coai-modules.mjs`); the display recorder, moved onto it, reproduces `coai-display-1056aed9.json` byte for byte | checked by hand | re-recorded and compared with `cmp` (E2.S2); a recorder is not part of the suite |
| A page's ± size / ± tone press posts one step, a pushed value repaints the page (zoom and tone scripts RUN) | covered | `src/test/displayScripts.test.ts` |
| For ConnectOtherAIs' config the display markup, scripts and CSS are byte-identical to coai `1056aed9` (values recorded from coai's own modules by `scripts/record-coai-display.mjs`) | covered | `src/test/displayByteCompat.test.ts` — shown to have teeth: a zoom step of 1.2 turns 9 of its tests red |
| A CSS prefix that could close a rule or a string (`x;}body{…`, a quote, uppercase, empty) is refused when the config is made AND at every point of use, so a forged plain-object config cannot reach a stylesheet | covered | `src/test/displayConfig.test.ts` — red first: 8 tests failed with *Missing expected exception* before `usablePrefix` was wired (gate, epic 1 code round, finding 6) |
| A failed view-setting write is reported once, through the consumer's reporter | covered | `src/test/settingWritten.test.ts` |
| Setting writes run in order, two quick presses are two steps, a failure never stops the next write | covered | `src/test/writeQueue.test.ts` |
| Escaping: HTML text/attributes, a script body, a nonce safe in a CSP header | covered | `src/test/escape.test.ts` |
| **A posted message is validated before any write**: own `type` `zoom`/`tone` only; `delta` a finite number truncated to one step (below a whole step is no press); `field` absent or `''`; `null`, primitives, arrays, `NaN`, `±Infinity`, a numeric string, an object with `valueOf`, a prototype key or an inherited `type` all refused with a typed reason — and `readPress` never throws | covered | `src/test/press.test.ts` — one row per shape. Red first against a first-cut parser of coai's `Number(delta)` shape: `'1'` accepted, `NaN` accepted with `step: NaN`, `Infinity` accepted, `0.5` accepted as a step, `0` accepted as `step: 0`, an array read as `unknown-type`, a `type` inherited through the prototype accepted. Teeth: reading members without `Object.hasOwn` turns the inherited-type row red |
| What the kit's own zoom and tone pages POST is what the host ACCEPTS — the page scripts run and their posts are fed to `readPress` (the one live check of a contract written on two sides) | covered | `src/test/press.test.ts` |
| A press is clamped and written ONCE, to the value coai's host wrote for the same stored value and delta (junk stored values, out-of-range deltas, `±99` as one step); `0` and `0.5` write nothing | covered | `src/test/displayHost.test.ts`, iterating the recorded writes |
| Two quick presses both land — the second reads what the first wrote | covered | `src/test/displayHost.test.ts` — red first against a host without the queue: `actual: [ 1, 1 ], expected: [ 1, 2 ]` |
| The two settings queue independently; a push never waits inside the write queue (a page that never answers cannot block a write) | covered | `src/test/displayHost.test.ts` — teeth: one shared queue, and a push awaited inside the queued write, each make the guarding test fail by its 2 s timeout |
| A failed write is reported once through the consumer's `settingNotSaved`, naming the source; the press still resolves; the next write still runs | covered | `src/test/displayHost.test.ts` |
| The pushed `uiScale` / `textTone` messages are byte-identical to what coai's `pushUiScaleTo` / `pushTextToneTo` posted, for every recorded offset, from the pure builders and from `attach` | covered | `src/test/displayHost.test.ts` — teeth: `px + 0.01` turns all ten offset tests red |
| A change in one setting is pushed to every attached page — that setting's message only; a press on one page reaches every page through the setting | covered | `src/test/displayHost.test.ts` |
| A closed page (its dispose event) receives nothing more and is not reported; a page detached by the returned disposable receives nothing more and its dispose listener is let go | covered | `src/test/displayHost.test.ts` — red first: the host posted to the closed page (`Error: Webview closed is disposed`); the detached page kept its dispose listener (`0 !== 1`) |
| A page whose `postMessage` resolves `false` or rejects is reported through `pushNotDelivered` (with `postMessage resolved false` / the rejection as text), detached, and never posted to again; the others still receive | covered | `src/test/displayHost.test.ts` — red first: the rejection escaped the host (`Error: webview rejecting refused the message`). Teeth: reporting without detaching fails `a detached page keeps a dispose listener` |
| `dispose()` unhooks every setting listener and every page's dispose listener, pushes nothing after, and refuses a later `attach`; attaching one page twice is refused | covered | `src/test/displayHost.test.ts` — red first: `2 !== 0` listeners after dispose; *Missing expected exception* for the double attach |
| The strict fakes keep their contract: undeclared setting refused by name, writes recorded and told to that setting's listeners only, held/failed writes, outside change, post after dispose counted and thrown, dispose listeners told once | covered | `src/test/fakeDisplayPorts.test.ts` |

## What it does not prove

A real VS Code extension host is never started here; the consumers' own suites (and coai's editor
harness) are where a real webview is exercised. In particular:

- The adapters a consumer writes around `vscode.workspace` and `panel.webview` are not here; that
  `update(…, ConfigurationTarget.Global)` syncs is VS Code's promise, observed in the consumers.
- The host reads `postMessage` resolving `false` as "the page is gone" — VS Code's documented contract,
  not something this suite can observe; a consumer's editor harness is where that is seen.
- `pushNotDelivered` is assumed not to throw (`DisplayReporter`'s contract); nothing here exercises a
  reporter that does.
- coai's real help BODIES are not compared — only its id coverage and its engine over small modules; the
  coai switch PR snapshots its rendered help before and after, which is where 800 KB of real content is
  held.
- `help-digests`' default kit path is exercised from an installed LAYOUT the suite builds by hand
  (`node_modules/<name>/{package.json, scripts/, dist/}` with this build's `out/` as `dist/`), not from a
  tarball npm installed — npm's own bin shims and exec bit are E3.S1's consumer fixture. In this repository
  the default needs `npm run build` first; it was run by hand against `dist/` (E2.S3).
- The help page is held against coai's page over SYNTHETIC articles; coai's real 800 KB of help and its
  real prompt listing are held by the coai switch PR's own before/after snapshot.
- `style-src 'unsafe-inline'` is coai's and is kept; the suite asserts the page's one `<style>` carries only
  the kit's constants and clamped numbers by construction (byte-compat), not by a separate scan.
- Whether VS Code delivers a `postMessage` sent before a webview's HTML loads is not observable here; the
  panel sets the HTML first and attaches after, as coai did, and a test pins that order.
- An 8-hex digest is 32 bits: two different English texts sharing one by chance is not tested and is
  accepted (one in about four billion per edit).

## When it runs

On every pull request and push to `main`, in CI.
