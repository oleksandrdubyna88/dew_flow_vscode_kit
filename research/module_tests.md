# module_tests — the harness, the flows it drives, and what it does not prove

> Adopted 2026-10-02 with no product code yet; a flow is `not covered` until its module lands. As of E2.S3
> every module of epics 1 and 2 has landed and every flow below is covered; since E3.S1 the
> pack-install-bundle-run flow is covered too, by the consumer fixture (below).

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
  reason, make the next watch of one setting throw (`failNextWatch`, for a constructor that fails part
  way), and change a setting from "outside"; counts live listeners. `FakeWebview` records every post as
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

### The consumer fixture and `pack-and-consume` (E3.S1)

Everything above runs on `out/`, the suite's own compile. What SHIPS is the tarball, so one check consumes
exactly that, the way an extension does — the family rule "verify the ARTEFACT, not the source":

- `test/consumer-fixture/` — a minimal consumer extension, never installed in place: `package.json` names the
  kit as `file:../kit.tgz`; `tsconfig.json` is a consumer's strict set with `node16` resolution (the
  `exports` map and its `types` condition) and `skipLibCheck: false` (the shipped `.d.ts` must compile under
  it); `src/vscode.d.ts` declares the slice of `@types/vscode` the adapters touch, so nothing is downloaded;
  `src/helpCatalog.ts` is a catalog written as a consumer writes one — a `uk` module whose `from` is a
  LITERAL digest; `src/extension.ts` adapts `vscode.workspace` and a `WebviewPanel` to `ConfigurationPort` and
  `HelpPanelPort` exactly as README "Use" shows, makes ONE display host and a help panel with an appendix,
  and renders a page of its own through `escapeHtml`, `jsonForScript`, `nonce` and the two controls.
- `test/consumer-fixture/run.mjs` — runs the BUNDLE under node: a `require` that answers `vscode` with a
  stub, hands out node built-ins and REFUSES anything else (so a bundle that still needs the kit at run time
  fails), and a stub whose every object throws on a member it does not have, naming it. It drives the
  fixture: activate, the help command, the page's CSP nonce equal to its one script's, the attachment's
  pushes, a press written once to the user scope and pushed back larger, a non-numeric delta, an unknown
  type and a language the catalog does not offer writing nothing, a language re-rendering the page in
  Ukrainian under a NEW nonce, the escapers holding a `</script>` title and payload, no notice reported, and
  after the panel closes and deactivate runs, no configuration listener, message listener or command left.
- `scripts/pack-and-consume.mjs` — eight named steps, each a `node <script> <args>` child (no shell) with
  npm's `npm_*` variables removed: **pack** from a repository whose `dist/` it first deletes, so only
  `prepack` can build it; **contents** read from the tarball's own tar headers (`dist/index.js`,
  `dist/index.d.ts` and every `bin` target present; nothing outside `files` and npm's three; `dist/` only
  `.js` / `.d.ts`); **fixture** copied to the OS temp dir with the tarball beside it; **install** `npm install
  --offline`; **typecheck** with this repository's TypeScript; **bundle** with this repository's esbuild and
  the extensions' flags, every input inside the copy; **run**; **bin** through `npm exec --no` (npm's `.cmd`
  shim on Windows) over the bundled catalog, which must answer "every translation was made from the current
  English" — and on POSIX the `.bin` link executed directly (exec bit and shebang). `--broken-import`
  rewrites `createDisplayHost` to `createDisplayHots` in the copy and refuses to run if there is no such
  import line to misspell. The temp dir is removed pass or fail. About 15–27 s on this Windows machine
  (pack 3–6 s with the build, install 1.5–2.6 s, bin 2.7 s; the first run after a fresh esbuild install
  spent 14 s in esbuild's first start).
- `src/test/packaging.test.ts` runs it twice — the normal run and `--broken-import` — at the end of the file
  that also runs the dry-run pack: the pack rebuilds `dist/`, the dry-run walks it, and tests inside one
  file run one after another where files run side by side. **So `npm test` rebuilds `dist/`.** CI runs it a
  third time, alone, in `.github/workflows/pack-and-consume.yml` on both platforms — the job the release
  workflow calls (E3.S2).

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
| **The panel's lifetime**: `dispose()` (twice) and the panel closing each unhook all four hooks — language listener, message listener, display attachment, dispose listener — and leave the consumer's display host serving other pages; nothing re-renders or is pushed after; `render` and `handle` throw after dispose | covered | `src/test/helpPanel.test.ts` — red first: the display attachment's dispose listener survived (`actual: 1, expected: 0`). Teeth: replacing the attachment's disposable with a no-op turns it red |
| A language write already in flight when the panel is disposed still lands; a choice still QUEUED behind it is dropped and not reported — the display host's rule (gate, epic 2 code round, finding 0, applied to the panel) | covered | `src/test/helpPanel.test.ts` — red first: `actual: [ 'ru', 'es' ], expected: [ 'ru' ]`; removing the guard again turns it red |
| **A panel is made all or none** (gate, epic 2 code round, finding 3): when the language listener, the message listener or the panel's own dispose listener cannot be registered, the error is rethrown and nothing is left — the display attachment detached (no dispose listener on the panel, no further push), no message or language listener — while the consumer's display host keeps its two | covered | `src/test/helpPanel.test.ts`, one test per later registration — red first, all three: `a dispose listener — the display attachment's or the panel's — outlived a panel that was never made` (`1 !== 0`) |
| The help panel's strict fake keeps its contract: HTML recorded in order, each listener handed its own clone, an inherited member never arrives, a function cannot be sent, a message with no listener fails, nothing after dispose | covered | `src/test/fakeHelpPanelPort.test.ts` |
| **The 0.1.0 API is exactly what `src/index.ts` exports**: the value names read from the compiled entry and the type names read from the index's export lists each equal an expected list; nothing internal (`Host`, `Panel`, `sha256Hex`, the chrome strings, the posted-message reader, …) leaks | covered | `src/test/exports.test.ts` — red first before the index was widened: 13 values and 9 types missing (`asText`, `nonce`, `WriteQueue`, `renderHelpPage`, `createHelpPanel`, …; `HelpPanelPort`, `HelpAppendix`, …) |
| **No page module reaches a host module, even one hop away**; the panel and the index do reach `nonce.ts`; the import reader is pinned on a fixture | covered | `src/test/architecture.test.ts` — teeth: an import of `nonce` added to `help/page.ts` turns the closure test red while the per-file scan stays green |
| **No `JSON.stringify` interpolated into a template literal** in any shipped source, beyond two error messages allowlisted by exact line | covered | `src/test/scriptInterpolation.test.ts` — teeth: routing the page script's `HOME` through `JSON.stringify` turns the scan red while every byte-compat test stays GREEN (the bytes are equal for these inputs), which is exactly the case only the scan can see |
| **`help-digests` reaches consumers**: the manifest names the bin `vscode-webview-kit-help-digests` → `scripts/help-digests.mjs` and lists it in `files`; `npm pack --dry-run` carries it and otherwise only `dist/`, the manifest, README and LICENSE; run from an installed layout with no `--kit` it uses that package's own `dist/` (exit 1 with the lines; exit 0 when fresh); it starts with a node shebang | covered | `src/test/packaging.test.ts` — red first before `package.json` changed: the bin was `undefined` and the pack lacked the script. Teeth: resolving the default kit from the cwd turns the installed-layout run red |
| **The packed tarball is what a consumer gets** (E3.S1): `npm pack` from a repository with no `dist/` carries `dist/index.js`, `dist/index.d.ts` and the bin script, built by `prepack`, and nothing unexpected; `npm install` of it offline installs this manifest's version; the fixture type-checks against the INSTALLED `.d.ts` under `node16` / `skipLibCheck: false`; esbuild bundles it with the extensions' flags from inside the copy only; the bundle RUNS under the `vscode` stub — help page under a CSP nonce, a press validated and written once through the stub configuration and pushed back, refused messages writing nothing, a language re-render under a fresh nonce, the escapers, every listener unhooked; the installed bin answers through `npm exec` (and the `.bin` link on POSIX) | covered | `src/test/packaging.test.ts` → `scripts/pack-and-consume.mjs` over `test/consumer-fixture/`. Red first for finding 1 (epic 3 plan round): before `prepack` existed the run stopped at `contents` — *the tarball lacks dist/index.js, dist/index.d.ts — did prepack build dist/? It carries: LICENSE, README.md, package.json, scripts/help-digests.mjs*. Teeth: writing to `ConfigurationTarget.Workspace` in the fixture's adapter fails `run` (`+ target: 2, - target: 1`); marking the kit external in the bundle fails `run` (*the bundle required "@oleksandrdubyna88/vscode-webview-kit" at run time*); each file restored and checked by SHA-256 |
| **A misspelled import fails the pipeline AT THE TYPECHECK** (`--broken-import`: `createDisplayHots`): exit 1, `FAILED at step "typecheck"` naming the name — TS2724 *has no exported member named 'createDisplayHots'. Did you mean 'createDisplayHost'?* — after `install` passed, and nothing after it runs | covered | `src/test/packaging.test.ts` — red first against the script with its typecheck step removed: the test failed with *FAILED at step "run": … TypeError: (0 , import_vscode_webview_kit2.createDisplayHots) is not a function* — esbuild bundles a missing named import from a CommonJS module without a word, so without the typecheck the misspelling surfaces only when the extension activates. Step restored, SHA-256 identical, green |
| **SHA-256** (`src/help/sha256.ts`, pure TypeScript) equals the standard: FIPS 180-2's five vectors (empty, `abc`, the 448- and 896-bit messages, one million `a`), and `node:crypto` at every length 0–200 bytes and over 300 seeded random strings (Cyrillic, emoji, NUL, lone surrogates) | covered | `src/test/sha256.test.ts` — red first against a stub answering 64 zeros: 7 of 8 red (`actual '0000…' expected 'e3b0c442…'`) |
| **The digest's canonical form** (plan §2): the six fields by name in the fixed order, joined with U+0000, UTF-8, no other normalisation, first 8 hex — two vector literals computed independently by `node:crypto` (`fb76c375`, and `eafba843` for a Cyrillic body); CRLF ≠ LF, a trailing space or newline and a decomposed accent each change it; moving a character across a field boundary changes it; extra properties do not; a missing field is refused by name; `isDigest` accepts 8 lowercase hex only | covered | `src/test/digest.test.ts` — red first against a first cut that normalised CRLF, trimmed and joined with no separator: 7 of 12 red (`'TitleWhat it is…'` for the canonical form; CRLF and LF both `1e500044`; a missing field threw `Cannot read properties of undefined`). Teeth: emptying the separator turns the two vectors, the canonical form and the boundary test red |
| For coai's content `bodyFor` answers coai's **body and `fallback`**: every answer coai's own `bodyFor` gave over partial modules (a missing body, an empty language), recorded by `scripts/record-coai-help.mjs`; the fallback matrix over coai's real coverage (33 articles × 5 languages); `HELP_LANGUAGES` and the labels | covered | `src/test/helpCatalog.test.ts` (passes against a straight port of coai's engine too — it is the compatibility half) |
| **Deviation:** an article id that is a key of `Object.prototype` (`constructor`) — coai answered the Object function as its translated body (recorded); the kit reads own properties only and falls back to English | covered | `src/test/helpCatalog.test.ts` — red first against coai's port. Teeth: a prototype lookup turns both own-property tests red |
| **`stale`**: `fresh` when `from` equals the current English digest; an English edit makes exactly that article `stale` in every language that has it, the others fresh; a body with no `from` is `unknown`; English and a fallback are always `fresh` | covered | `src/test/helpCatalog.test.ts` — red first against coai's port (`stale` always `fresh`: `actual 'fresh' expected 'unknown'`). Teeth: folding `unknown` into `fresh` turns 7 tests red across the catalog, coverage and script suites |
| **The catalog never aliases its input** (gate, epic 2 code round, finding 5): editing what was handed in after `createCatalog` — an English title, an English body field, a translated body, a `from` digest, an article id, the articles array, the translations object — changes nothing `bodyFor` answers or `renderHelpPage` renders, in any language; every record reachable from the catalog is frozen and a write through it throws a `TypeError` | covered | `src/test/helpCatalog.test.ts` — red first: `the catalog showed an edit made to its input after createCatalog` (ids `[ 'alpha', 'beta', 'renamed' ]` for `gamma`, and the edited texts); `records of the catalog that can still be written` (`catalog.articles.0`, `catalog.articles.0.en`, …, `catalog.translations.ru.bodies.alpha`, …). The byte-compat suites stayed green over the copies. Findings 6 and 7 (a `Set` of ids for the translated-body check; a render walks the articles instead of finding each one) change no behaviour and carry no red of their own: the refusal, byte-compat and page suites are their guard |
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
| **Nothing is written after `dispose()`** (gate, epic 2 code round, finding 0): `press()` and `apply()` throw synchronously, as `attach` does, write nothing and report nothing; a press still QUEUED behind a held write when `dispose()` runs is never written — the write already in flight lands — and both promises resolve with nothing reported | covered | `src/test/displayHost.test.ts` — red first: `a disposed host wrote a setting` (`actual: [ { setting: 'coai.uiScale', value: 1 }, { setting: 'coai.textTone', value: -1 } ]`); `a press queued behind a held write was written after dispose` (`actual: [ 1, 2 ], expected: [ 1 ]`) |
| **A host is made all or none** (finding 2): when the `textTone` watch is refused after the `uiScale` one succeeded, the `uiScale` listener is unhooked and the registration's own error is rethrown | covered | `src/test/displayHost.test.ts` with `FakeConfiguration.failNextWatch` — red first: `the uiScale listener outlived a host that was never made` (`1 !== 0`) |
| **A detached push never rejects** (finding 4): a `pushNotDelivered` that throws — for a page whose post resolves `false` and for one that rejects — is no unhandled rejection; the page is detached first and `reporterFailed` is told the reporter's error; a page whose dispose hook throws as it is let go has THAT error told; with no `reporterFailed` the error goes to `console.error`, and a `reporterFailed` that throws itself goes to `console.error` with both errors | covered | `src/test/displayHost.test.ts`, listening on `process` `unhandledRejection` — red first: for the `false` page `the reporter's own failure was swallowed` (`actual: []` — the old `catch` re-entered `lost`, which returned early, so the throw vanished silently); for the rejecting page the runner failed the test with `failureType: 'unhandledRejection'`, `error: "the consumer's log line broke"`, as it did the `console.error` test. The dispose-hook test was written after the fix; teeth: re-throwing from the catch-all at the edge turns all four of these tests red |
| **`hookAll`** (`src/webview/hooks.ts`), the helper both constructors use: every hook made in order and handed back frozen; a maker that throws undoes the earlier hooks newest first and its own error (an `Error` or not) is rethrown untouched; an undo that throws too still lets every undo run and surfaces as an `AggregateError` with the registration's error first | covered | `src/test/hooks.test.ts` — written with the helper; teeth: rethrowing without the rollback turns 2 red (`actual: [ 'make a', 'make b' ]`), undoing oldest first turns 2 red (`actual: [ 'make a', 'make b', 'undo a', 'undo b' ]`) |
| The strict fakes keep their contract: undeclared setting refused by name, writes recorded and told to that setting's listeners only, held/failed writes, a watch that throws once for one setting (`failNextWatch`) and hooks nothing, outside change, post after dispose counted and thrown, dispose listeners told once | covered | `src/test/fakeDisplayPorts.test.ts` |

## What it does not prove

A real VS Code extension host is never started here; the consumers' own suites (and coai's editor
harness) are where a real webview is exercised. In particular:

- The adapters a consumer writes around `vscode.workspace` and `panel.webview` are not here; that
  `update(…, ConfigurationTarget.Global)` syncs is VS Code's promise, observed in the consumers.
- The host reads `postMessage` resolving `false` as "the page is gone" — VS Code's documented contract,
  not something this suite can observe; a consumer's editor harness is where that is seen.
- A reporter that throws is caught and handed to `reporterFailed`, which defaults to `console.error`; that
  the extension host's console reaches a log a person reads is VS Code's, not observable here.
- coai's real help BODIES are not compared — only its id coverage and its engine over small modules; the
  coai switch PR snapshots its rendered help before and after, which is where 800 KB of real content is
  held.
- `help-digests`' default kit path is exercised twice: from an installed LAYOUT the suite builds by hand
  (`node_modules/<name>/{package.json, scripts/, dist/}` with this build's `out/` as `dist/`), and since
  E3.S1 from the tarball npm installed, through npm's shim (`.cmd` on Windows; the executable `.bin` link on
  POSIX, which this Windows machine cannot run — the Linux CI leg is where the exec bit is observed).
- The consumer fixture's `vscode` is a stub and its declaration a local slice of `@types/vscode`: that the
  real `@types/vscode` accepts the same adapters is the consumers' own typecheck, and a real extension host
  is their editor harness. The fixture uses `node16` resolution; a consumer on `bundler` resolution reads the
  same `types` condition, which is not run separately.
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

`npm test` runs everything above, `pack-and-consume` included (both modes, about 12 s of a 20 s suite here).
CI's `build-test` job runs `npm test` on both platforms, and `ci.yml` also calls the reusable
`pack-and-consume.yml`, which runs `npm run pack-and-consume` alone on both platforms — the job E3.S2's
release workflow calls again before it publishes.
