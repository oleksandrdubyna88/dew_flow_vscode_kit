# module_tests — the harness, the flows it drives, and what it does not prove

> Adopted 2026-10-02 with no product code yet; a flow is `not covered` until its module lands.

## Where the harness is and how it runs

`src/test/` beside the sources, compiled with them by `npm run compile` (tsc → `out/`; `tsconfig.build.json`
keeps it out of `dist/`) and run by `npm test`: `scripts/run-tests.mjs` reads `out/test/` and hands every
`*.test.js` to `node --test` — a readdir, no glob, no shell. CI runs the same command on `ubuntu-latest`
and `windows-latest`, after `git config --global core.autocrlf false`.

The helpers the tests share:

- `src/test/pageHarness.ts` (E1.S1) — RUNS a page script in a `node:vm` context whose globals are an
  explicit allowlist (`document`, `window`, `acquireVsCodeApi`), under a 5 s deadline that also covers every
  click and message the test dispatches afterwards. Stricter than a browser: `querySelector` /
  `getElementById` answer `null` on a miss, a node the page was never handed cannot be clicked, `closest`
  refuses a selector shape it cannot read, and what the page posts must be structured-cloneable.
- `src/test/lineEndings.ts` (E1.S1) — `assertNoCr(text, what)`, failing with the index of the first CR, so
  a rendered fragment cannot pass on one platform and fail on the other.
- `src/test/coaiFixture.ts` (E2.S1, E2.S2) — the one reader of the coai recordings:
  `src/test/fixtures/coai-display-1056aed9.json`, which `scripts/record-coai-display.mjs` writes from
  ConnectOtherAIs' own modules at `1056aed9` (the pure halves directly; the host halves through a typed
  `vscode` stub), and `src/test/fixtures/coai-help-1056aed9.json`, which `scripts/record-coai-help.mjs`
  writes from coai's own `helpContent.ts` (over partial translation modules it writes, and over coai's own
  four). Nothing in either is retyped.
- `src/test/fixtures/helpDigestsCatalog.ts` (E2.S2) — a consumer's catalog module as `help-digests`
  loads one: a stale, an unknown and a fresh translation (`catalog`), an all-fresh one (`freshCatalog`),
  and an invalid input (`brokenInput`); every `from` read back from `digestOf`.
- `src/test/fakeDisplayPorts.ts` (E2.S1) — strict fakes of the display host's two ports.
  `FakeConfiguration` refuses, by name, any setting the test did not declare; records every applied
  write; can hold writes pending (all, or one setting's) and release them, fail the next write with a
  reason, and change a setting from "outside"; counts live listeners. `FakeWebview` records every post as
  a structured clone, answers as told (`delivered` / `refused` / `rejects` / `hangs`), counts AND throws
  on a post after `dispose()`, and counts live dispose listeners. Both have their own contract tests.

`src/test/architecture.test.ts` scans every pure module — everything under `src/` outside `src/test/` and
the host allowlist (`src/webview/nonce.ts`) — for `vscode` / `node:` imports and fails naming `file:line`;
a companion test proves the scan finds all four import shapes in a fixture, so it cannot pass vacuously.
The display host, its ports and the press validator are pure by this scan, and so is the whole help
catalog — `sha256.ts` included, which is why SHA-256 is TypeScript here (see `architecture.md`): the
allowlist did not grow.

## Flow catalogue

| Flow | Covered | By |
|---|---|---|
| A page script runs under the harness: a press posts through `acquireVsCodeApi`, a pushed message repaints, an undeclared global is a `ReferenceError`, an infinite loop fails by the deadline | covered | `src/test/harness.test.ts` |
| No pure module imports `vscode` or a `node:` API | covered | `src/test/architecture.test.ts` |
| A consumer renders the help page and navigates it | not covered | the help page and panel are not built yet (E2.S3) |
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
- `help-digests`' default kit path (`../dist/index.js`) needs a build, so the suite passes `--kit`; the
  default was run by hand against `npm run build` output (E2.S2). The script is not yet in the published
  package (`files: ["dist"]`).
- An 8-hex digest is 32 bits: two different English texts sharing one by chance is not tested and is
  accepted (one in about four billion per edit).

## When it runs

On every pull request and push to `main`, in CI.
