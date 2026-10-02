# PLAN — extract the help / text-size / text-tone / setting-write modules into one shared package

> Status: **in progress, 2026-10-02** — epic 1 and epic 2 (E2.S1, E2.S2, E2.S3) have landed on their
> branches; epic 2's code round, epic 3 and the consumer switches are open. Scope: this repository's first release,
> `@oleksandrdubyna88/vscode-webview-kit` 0.1.0, and the switch of its two consumers.
>
> Cross-repository: the consumer side is named in `wsl_care · todo/PLAN_shared_vscode_kit.md` (the
> proposal this plan executes) and will be named in `dew_flow_connect_other_ais · todo/` when the
> switch PR opens there.

## 1. Goal

`wsl_care`'s VS Code extension needs ConnectOtherAIs' help page (five languages, fallback), its ± text
size and ± text tone controls, and its setting-write reporter. Copying them makes two drifting copies on
day one. The user decided (2026-10-02): **extract them into this repository and publish them as a
package both extensions consume.**

What must be true when this plan is done:

1. The package builds to CommonJS + `.d.ts`, has **no runtime dependencies**, and is published to npmjs
   from CI with provenance as 0.1.0.
2. For ConnectOtherAIs' own configuration (`coai`, `ConnectOtherAIs`, CSS prefix `coai`) every pure
   function returns **byte-identical** output to the coai source of 2026-10-02 (`1056aed9`), proved by
   tests that hold the kit's output against literals copied from that source.
3. Help gains what coai only planned: **stale-translation detection** — a translation records the digest
   of the English body it was made from, and a changed English body marks that translation stale and
   shows a note.
4. Host halves (size, tone, help panel) take a narrow PORT instead of the `vscode` namespace, so they are
   unit-tested with a fake.
5. ConnectOtherAIs imports the package instead of its own copies (separate PR in that repository), its
   whole suite unchanged and green; `wsl_care` imports it from its first extension commit.

Constraints: no behaviour change for coai users; no runtime dependency; webview page scripts tested by
running them; English UI except help bodies and help chrome.

**Security of the pages (gate, plan round 1):** every page the kit renders carries a
Content-Security-Policy with `default-src 'none'` and a fresh per-render nonce on its one script; the
HOST validates every message a page posts before acting on it — a known `type`, a numeric `delta`
reduced to its sign, a language taken only from the catalog's list — and ignores anything else. An
origin check is not applicable: a VS Code webview can post only to its own panel through
`acquireVsCodeApi`, and there is no foreign origin in that channel.

## 2. What moves, from where, into what

Source: `dew_flow_connect_other_ais/src_vs_code/src/` at `1056aed9`.

| coai module (lines) | Kit module | Generalised by | Stays in coai |
|---|---|---|---|
| `asText.ts` (20) | `src/text/asText.ts` | — | re-export |
| `webviewHtml.ts` — `escapeHtml`, `escapeHtmlForHighlighting`, `jsonForScript` | `src/webview/escape.ts` | — | the layout constants, `COPY_ICON`, `groupsGridCss` (coai-specific) |
| `writeQueue.ts` (46) | `src/webview/writeQueue.ts` | — | re-export |
| `settingWrite.ts` (39) | `src/settings/settingWritten.ts` | the reporter is injected (coai passes its `notify`) | a one-line adapter |
| `zoomControl.ts` (84) | `src/display/zoom.ts` | `product` name in the tooltip | re-export via its config |
| `textTone.ts` (159) | `src/display/tone.ts` | `product`, CSS variable prefix | re-export via its config |
| `uiScaleHost.ts` (51), `textToneHost.ts` (60) | `src/display/host.ts` | a `ConfigurationPort` + section/keys | a thin binding to `vscode.workspace` |
| `helpContent.ts` engine (types, languages, `bodyFor`) | `src/help/catalog.ts` | articles + translations passed in; adds `stale` | the ARTICLES and `help<Lang>.ts` |
| `helpPage.ts` (319) | `src/help/page.ts` | catalog, display config, an `appendix(id, language)` hook (coai's prompt listing) | `helpPrompts.ts` and the hook |
| `helpPanel.ts` (97) | `src/help/panel.ts` | a `HelpPanelPort` (create panel, config, messages), viewType/title/section/key | a thin binding |
| — (new) | `src/help/digest.ts` | `digestOf(body)`: see the canonical form below | — |

**The digest, canonically (gate, plan round 1):** the six fields in the fixed order `title`,
`whatItIs`, `why`, `setup`, `usage`, `whatCanGoWrong`, joined with U+0000, encoded UTF-8, no other
normalisation; the digest is the first 8 hex characters of SHA-256 over those bytes.

**Where a translation keeps it:** each translation module exports `{ bodies, from }` — `bodies` maps an
article id to its translated `HelpBody`, `from` maps the same id to the digest of the ENGLISH body it was
translated from. `bodyFor` answers `{ body, fallback, stale }`: `fallback` when the language has no body
for the article, `stale: 'stale'` when it has one whose `from` differs from the current English digest,
and `stale: 'unknown'` when it has no `from` entry at all — never assumed fresh. **Bootstrap:** the coai
switch stamps the CURRENT English digests for every existing translation, on the stated assumption that
the shipped translations match today's English; a `help-digests` script prints the digests to paste
after a deliberate re-translation.

## 3. Build order

1. Repository machinery: `package.json`, `tsconfig.json` (coai's strict set incl. `noEmitOnError`,
   `exactOptionalPropertyTypes`), eslint, `scripts/run-tests.mjs` (readdir, per coai), CI workflow
   (`ci.yml`: conventions check, plan-lifecycle, typecheck, lint, test, build, `npm pack --dry-run`),
   `pr-title.yml`, `coderabbit-review.yml` + `.coderabbit.yaml`, dependabot.
2. `text`, `webview`, `settings` — with their tests ported from coai (`settingWrite.test.ts`, the
   escapers' tests).
3. `display/zoom`, `display/tone` — byte-compatibility tests against coai literals; the page scripts RUN
   against a minimal DOM (port of coai's harness pattern: `node:vm`, explicit globals, timeout).
4. `display/host` with the port and a strict fake.
5. `help/catalog` + `help/digest` (stale detection) + `help/page` + `help/panel`; tests: fallback, stale,
   coverage helpers a consumer can call (`everyArticleInEveryLanguage(catalog)`), the page script run
   (index ↔ article, search, Back, Escape, language post).
6. `release-please` (`node`, component-less tag `v0.1.0`), `release.yml` publishing with
   `npm publish --provenance --access public` (secret `NPM_TOKEN`), README usage.
7. Consumer PR in ConnectOtherAIs; consumer use in wsl_care.

## 4. Test plan

- Ported coai tests pass unchanged in meaning; every byte-compat test names the coai source line it
  copies.
- A deliberately broken kit function (e.g. step 1.2 instead of 1.1) turns a byte-compat test red —
  proof the comparison has teeth.
- Page scripts executed: zoom/tone buttons post `{type, delta}`; a pushed `uiScale`/`textTone` message
  repaints; help navigation and search work; the language select posts.
- Host with a fake port: a press is clamped and written once; two quick presses both land (the write
  queue); a pushed value reaches every registered webview; dispose unhooks.
- Stale: changing one English body makes exactly that article stale in every language that has it;
  untouched articles stay fresh; a missing digest is reported, not treated as fresh.
- Consumer smoke: coai's full suite green after the switch; the coai `.vsix` still bundles (its own
  bundle test).
- **Consumer-level checks in the coai switch PR** (gate): its binding passes section `coai`, keys
  `uiScale` / `textTone` / `helpLanguage`, product `ConnectOtherAIs` and CSS prefix `coai`, and the
  rendered help, zoom and tone markup equals a snapshot taken from the build BEFORE the switch.
- **Both platforms** (gate): CI runs the suite on `ubuntu-latest` and `windows-latest`; `.gitattributes`
  forces LF; rendered output is asserted to contain no CR, so a byte-compat test cannot pass on one
  platform and fail on the other.
- **The artefact before it is public** (gate): a CI job packs the tarball, installs it into a minimal
  consumer fixture and bundles that fixture with the extensions' esbuild flags (`--bundle
  --external:vscode --format=cjs --platform=node`); the publish job depends on it.

## 5. Growth surfaces

The package keeps no files and no caches. Its one growing structure is the **write queue**, one per
host instance: a promise chain whose length is the number of presses not yet written, each press one
settings write; a settled write is not retained, and a failed one is handed to the injected reporter
rather than kept. Every configuration listener a host registers is returned as a `Disposable`, and the
help panel disposes all of them when it closes — a closed page holds nothing.

## 6. Release, rollback, and the order of the switches

1. The kit publishes 0.1.0 from its own repository first, verified with `npm view` and an install of
   the published artefact into the consumer fixture.
2. Then each consumer switches in a pull request of its own repository, pinning the EXACT version.
3. **A bad release is fixed forward**: npm versions are immutable, so the fix ships as 0.1.1 and the bad
   version is `npm deprecate`d with the reason. Nothing is ever unpublished.
4. **A failed switch is a reverted pull request** in that consumer — its previous modules are in its git
   history, and a consumer that never switched is unaffected by a kit release.

## 7. Epics and stories (split 2026-10-02, on Fable, as the gate's operator commands require)

Three epics, each a branch stacked on the previous epic's commit, each closed by one review-gate code
round over its whole diff and a green CI. Model per story follows `common.subagent-models`: Opus by
default, Fable where a wrong answer is paid for later (architecture of the new package, the
webview→host trust boundary, publishing credentials).

| # | Epic | Branch | Base | True when done |
|---|---|---|---|---|
| 1 | Foundation and the pure modules | `feat/kit-e1-foundation-pure` | `main` @ `34338f4` | `npm ci && npm run typecheck && npm run lint && npm test && npm run build` green on ubuntu-latest AND windows-latest; `dist/` is CommonJS + `.d.ts`; zero runtime dependencies; `text`, `webview`, `settings`, `display/zoom`, `display/tone` ported and byte-identical to coai `1056aed9` for coai's config, proved with teeth; page scripts RUN in a deny-by-default `node:vm` harness; rendered output asserted CR-free |
| 2 | Host ports and the help subsystem | `feat/kit-e2-host-help` | E1's merge commit | `display/host`, `help/catalog`, `help/digest`, `help/page`, `help/panel` behind narrow ports with strict fakes; every webview message validated host-side; CSP nonce per render; stale-translation detection with `{ bodies, from }`; `src/index.ts` exports the whole 0.1.0 API; README "Use" |
| 3 | Release pipeline and 0.1.0 | `feat/kit-e3-release` | E2's merge commit | the pre-publish job packs, installs into a consumer fixture and bundles with esbuild on both OSes; `release.yml` publishes with provenance only after it; `v0.1.0` tagged by release-please; `npm view` prints `0.1.0`; POST_DEPLOY 1–2 pass; research docs describe what shipped |

### Epic 1 — Foundation and the pure modules

- **E1.S1 — Repository machinery and the test harness** (Fable: the package layout and CI matrix every
  later story and consumer binds to). `package.json` (`files: ["dist"]`, `main`/`types`/`exports`, no
  `dependencies`), `tsconfig.json` (coai's strict set, CJS out), `eslint.config.mjs`
  (`linebreak-style: unix`), `.editorconfig`, `scripts/run-tests.mjs`, `.github/workflows/ci.yml` (matrix
  ubuntu/windows; `core.autocrlf false` before checkout; conventions check, plan-lifecycle, typecheck,
  lint, test, build, `npm pack --dry-run`), `pr-title.yml`, `coderabbit-review.yml` + `.coderabbit.yaml`,
  dependabot, an empty `src/index.ts`, `src/test/pageHarness.ts` (`node:vm`, explicit global allowlist,
  `timeout: 5000`, `posted[]`), `src/test/lineEndings.ts` (`assertNoCr`). Tests: an infinite fragment
  fails by timeout; an undeclared global is a `ReferenceError`; `assertNoCr` rejects `\r`.
- **E1.S2 — `text`, `webview`, `settings`** (Opus). `src/text/asText.ts`, `src/webview/escape.ts`
  (`escapeHtml`, `escapeHtmlForHighlighting`, `jsonForScript`, `nonce()`), `src/webview/writeQueue.ts`,
  `src/settings/settingWritten.ts` (reporter injected). Tests: the ported setting-write and escaper
  cases, two quick presses are two steps, a queued write never waits on itself, and the growth budget —
  after N presses settle nothing is retained.
- **E1.S3 — `display/zoom` and `display/tone`, pure halves** (Opus). `src/display/config.ts`
  (`DisplayConfig { product; cssPrefix }`), `src/display/zoom.ts`, `src/display/tone.ts`. Tests:
  byte-compat against coai literals with the source line named, with teeth (a step of 1.2 must make the
  assertion throw); the page scripts RUN (a click posts `{type, delta, field:''}`, a pushed value
  repaints); `assertNoCr` on every fragment.
  *As built:* the config is made through `createDisplayConfig(product, cssPrefix)`, which refuses a
  prefix that is not lowercase letters, digits and dashes; `tone.ts` re-checks it at every point of use
  (`usablePrefix`), because a plain object literal typed as `DisplayConfig` skips the factory (gate,
  epic 1 code round, finding 6).

### Epic 2 — Host ports and the help subsystem

- **E2.S1 — `display/host` with `ConfigurationPort` and press validation** (Fable: the public port and
  the webview→host trust boundary). `src/display/port.ts`, `src/display/press.ts` (known type only,
  finite numeric delta reduced to its sign, anything else rejected), `src/display/host.ts`
  (`createDisplayHost`), a strict fake port. Tests: clamp and one write per press, two quick presses
  both land, push reaches every webview, dispose unhooks, the validation table.
  *As built:* a fourth file, `src/display/messages.ts`, holds the two pushed-message builders as a pure
  half. The port is `ConfigurationPort` (read raw / write to the user scope / `onDidChange`, keyed by a
  `SettingName`) plus `WebviewPort` (`postMessage`, `onDidDispose` — the PANEL's event, which a
  `vscode.Webview` does not carry, so the consumer's adapter joins the two). `readPress` keeps coai's
  `textControlFrom` rule where coai's three parsers disagreed — truncate, then one step; below a whole
  step is no press and no write (coai's `applyZoomDelta` alone wrote the current value back for `0` and
  stepped on `0.5`) — reads own properties only, and refuses a `field` that is present and not `''`
  (no coai parser read `field`; the kit's pages post `''`). The host keeps one `WriteQueue` per setting,
  as coai did. A lost push is reported through a second funnel, `DisplayReporter.pushNotDelivered`,
  because `SettingNotSaved` is the wrong notice for it. The recorder (`scripts/record-coai-display.mjs`)
  gained a typed `vscode` stub, so the host fixture — messages per offset, writes per press — is derived
  from coai's own `uiScaleHost.ts` / `textToneHost.ts`, not retyped. After the epic 2 code round
  (findings 0, 2, 3, 4, 5): `press` / `apply` throw after `dispose()` as `attach` does, and a press still
  queued then is dropped; both constructors make their hooks all or none (`webview/hooks.ts`); a reporter
  that throws at the detached edge of a push goes to a new optional `reporterFailed` (default
  `console.error`) instead of an unhandled rejection; `createCatalog` keeps deep-frozen copies, never the
  input's own objects.
- **E2.S2 — `help/catalog` and `help/digest` with stale detection** (Opus). `types.ts`, `digest.ts`,
  `catalog.ts` (`bodyFor` → `{ body, fallback, stale: 'fresh' | 'stale' | 'unknown' }`),
  `bootstrap.ts` (`stampTranslations`), `coverage.ts`. Tests: a digest vector literal, bootstrap → nothing
  stale, an English edit → exactly that article stale, a missing `from` → `unknown`, fallback unchanged.
  *As built:* SHA-256 is a pure TypeScript `src/help/sha256.ts` (FIPS 180-4, pinned by the standard's
  vectors and a differential run against `node:crypto`), not `node:crypto` in a host-only file: `bodyFor` is
  on the path of the pure page module, a per-file import scan cannot see a host import one hop away, and
  Web Crypto is asynchronous — the host allowlist did not grow. The digest keeps §2's "no other
  normalisation" literally (a CR or a trailing space is an edit, and the tests assert that). `bodyFor` reads
  own properties only — coai answered the Object function as the translated body of an article called
  `constructor` (recorded by the new `scripts/record-coai-help.mjs`, which shares
  `scripts/coai-modules.mjs` with the display recorder; that one re-records its fixture byte-identically).
  `createCatalog` refuses, with a `TypeError` naming what and where, no articles, an empty or repeated id,
  a body missing a field, a module for an unknown language or for `en`, a body for an unknown article, a
  `from` without a body and a `from` that is not 8 lowercase hex; the languages are derived (English plus
  each module, in `HELP_LANGUAGES` order). `staleTranslations` entries carry `stale: 'stale' | 'unknown'`
  besides finding 0's four fields, with `from: null` when unknown; `everyArticleInEveryLanguage` answers
  `{ complete, missing }`. `help-digests` takes `--export <name>` (default `catalog`) and `--kit <entry>`
  (default `../dist/index.js`), exits 0 / 1 / 2, and re-makes the catalog with the kit's own
  `createCatalog`; it is NOT in the package's `files` yet, so shipping it to consumers (`files` / `bin`) is
  left to E2.S3 or E3. `src/index.ts` already exports the help catalog half; E2.S3 adds the page and panel.
- **E2.S3 — `help/page`, `help/panel`, the index and README** (Fable: CSP and the panel's message
  validation are security; `HelpPanelPort` is public). Tests: byte-compat of the whole page for coai's
  config with an injected nonce and appendix, with teeth; the page script RUN (index ↔ article, search,
  `noHits`, Back, Escape, language post); the panel with fakes (unknown type ignored, a language outside
  the list not written, re-render on change, dispose unhooks all listeners); `assertNoCr`.
  *As built:* the page is three files under the linter's limits — `page.ts` (`renderHelpPage`, `searchIndex`,
  `articleHtml`, `helpCsp`), `pageText.ts` (coai's chrome and section labels, `bodyHtml`, the notes) and
  `pageScript.ts` (coai's script in three pieces) — plus `messages.ts` (`readHelpMessage`), and
  `src/webview/posted.ts`, the own-member reader extracted from `display/press.ts` so both readers share it.
  The appendix hook is `(id, language) => string`, the consumer's own escaped markup, inserted as is.
  Byte-compat is held against seven whole pages recorded from coai's real `helpPage.ts` by
  `scripts/record-coai-help-page.mjs`: coai's `HELP_ARTICLES` export is reassigned to synthetic articles
  (recorded as input), the nonce is read back from each page, and coai's private `promptsHtml()` output is
  recovered as the difference between the `prompts-in-full` article and a twin; `coai-modules.mjs` gained
  `--typeRoots` because coai's page imports `node:crypto`. Deviations from coai's page, each silent for coai's
  bootstrapped catalog: the language switch lists `catalog.languages` rather than all five; a nonce shorter
  than 22 base64 characters and a language the catalog does not offer are refused with a `TypeError`; a
  `stale` or `unknown` translation carries `<p class="fallback stale">` with a sentence per language, and a
  fresh one carries nothing. The panel takes the consumer's ONE `DisplayHost` (which gained a `readonly
  config`) instead of making its own, so a help page is attached like any other page; `HelpPanelPort` is
  `WebviewPort` plus `setHtml` and `onDidReceiveMessage`; creating the `WebviewPanel` and the reveal-if-open
  singleton stay with the consumer (README "Use"). Deviations from coai's panel: a language is validated
  against `catalog.languages`, not all five; an unknown type is refused with a typed reason instead of being
  ignored silently; a stored language without a module reads as English; it renders before it attaches (coai's
  order, now pinned by a test); `render` / `handle` throw after dispose. `src/index.ts` exports the whole 0.1.0
  API — `text` and `webview` included — pinned name by name by `exports.test.ts`. Two more controls were
  added: the architecture test walks run-time import closures (no page module reaches `nonce.ts`), and
  `scriptInterpolation.test.ts` scans for an interpolated `JSON.stringify`. **`help-digests` ships**
  (coordinator's decision): `files` and `bin` (`vscode-webview-kit-help-digests`); its default `--kit` was
  already resolved from the script's own location, and `packaging.test.ts` runs it from a hand-built installed
  layout — a real `npm install` of the packed tarball is left to E3.S1's consumer fixture. The pageHarness
  gained event bubbling, `fire`, `value`, node-level `querySelectorAll`, `keydown` and `scrollTo`.

**Epic 2 plan round (session `ba62c9e9`, 2026-10-02):**

| # | Lands in | Decision |
|---|---|---|
| 0 | E2.S2 | **Accepted, changed.** A stale translation is the intended signal, not a defect — but an English edit committed without its translations must fail the CONSUMER's CI, not reach users. `coverage.ts` adds `staleTranslations(catalog)` → `[{ article, language, from, current }]` (both `stale` and `unknown`), which a consumer's test asserts empty; the `help-digests` script prints exactly those pairs with the replacement `from` line for each. `stampTranslations` stays the one-time bootstrap of the coai switch. |
| 1 | E2.S1 | **Accepted.** The host keeps a registry: `attach(webview)` returns a disposable and is also undone by the webview's own dispose event; a push iterates only attached webviews; a `postMessage` that resolves `false` or rejects is caught, logged through the consumer's reporter, and detaches that webview. A push never runs inside the write queue, so a dead webview cannot block a setting write. Tests: a disposed webview receives nothing, a rejecting one is detached and the others still receive. |
| 2 | — | **Rejected:** the test is already listed for E2.S2 ("a missing `from` → `unknown`"). It exposed an inconsistency in §2, which said *stale*; §2 now says `unknown`. |

### Epic 3 — Release pipeline and 0.1.0

- **E3.S1 — Pre-publish consumer fixture** (Opus). `test/consumer-fixture/`,
  `scripts/pack-and-consume.mjs` (pack → install → esbuild bundle → run under node with a `vscode`
  stub), a `pack-and-consume` CI job on both OSes. Tests: a fixture with a misspelled import goes red.
- **E3.S2 — release-please, `release.yml`, publish 0.1.0** (Fable: publishing credentials and the supply
  chain of two extensions). `release-please-config.json`, manifest, `release-please.yml`, `release.yml`
  (`needs: pack-and-consume`, `id-token: write`, `npm publish --provenance --access public` with
  `NPM_TOKEN`, SHA-pinned actions); README "Release and rollback"; research docs; POST_DEPLOY stamped.

**Order and what is left to the consumers.** E1 → E2 → E3 strictly; publishing finishes before any
consumer switches. The ConnectOtherAIs switch (its consumer-level tests, the `stampTranslations`
bootstrap of its four translation modules, deleting the moved modules) and wsl_care's first extension
commit are pull requests in those repositories.

## 8. Definition of Done

- [ ] 0.1.0 published from CI with provenance; `npm view @oleksandrdubyna88/vscode-webview-kit` shows it.
- [ ] Byte-compat tests green and shown to have teeth.
- [ ] Stale-translation detection implemented and tested.
- [ ] ConnectOtherAIs switched (merged PR), suite green; no copy of these modules left there.
- [ ] wsl_care's extension imports the package.
- [ ] `research/architecture.md`, `research/module_tests.md` describe what shipped; this plan promoted.
