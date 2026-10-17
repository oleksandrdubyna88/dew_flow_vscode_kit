# module_tests — the harness, the flows it drives, and what it does not prove

> Adopted 2026-10-02 with no product code yet; a flow is `not covered` until its module lands. As of E2.S3
> every module of epics 1 and 2 has landed and every flow below is covered; since E3.S1 the
> pack-install-bundle-run flow is covered too, by the consumer fixture (below). Since E3.S2 the release
> path's SHAPE and every decision it makes are covered here; the release itself — the App token, the tag,
> the publish, the signing — runs only on a real release and is listed under "What it does not prove".

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

### The release path (E3.S2)

The one run that exercises `release.yml` for real is a release, and a check that only runs then has never
run (common.testing). So everything that can be read off the files, or decided over facts, is held here on
every pull request:

- `src/test/workflowYaml.ts` — a reader for the YAML subset the workflows are written in (block mappings and
  sequences, a mapping opening on a `- ` line, plain and quoted single-line scalars, flow sequences, literal
  `|` / `|-` blocks, comments). It REFUSES, naming the line, anchors, aliases, tags, flow mappings, folded and
  multi-line plain scalars, tabs, a second document, duplicate keys and indentation it cannot place — so a
  workflow written outside the subset fails rather than being half-read. `workflowYaml.test.ts` pins its
  output on a sample, each refusal, and that every workflow in `.github/workflows` parses with a known
  instance still found (ci.yml's matrix).
- `src/test/releaseWorkflows.test.ts` — over the parsed workflows: `release.yml`'s only trigger is
  `release: published`; its top-level token reads contents; the publish job's permissions are EXACTLY
  `contents: read`, `packages: write`, `id-token: write`, `attestations: write`, and `packages`, `id-token`
  and `attestations` are keys nowhere else in any workflow; publish `needs:` the guard and the in-file call of
  `./.github/workflows/pack-and-consume.yml`, which itself needs the guard; publish runs in environment `npm`,
  which holds no secret — its `v*` tag rule is the fence; no npm token is named in any workflow, any
  `.github/scripts` file, anything under `scripts/` or `package.json`; setup-node's `registry-url` is
  `package.json`'s `publishConfig.registry` (`https://npm.pkg.github.com`) and its `scope` the scope of the
  name; the order guard → `npm test` → pack (`id: pack`, the job's ONE `npm pack`, writing `tarball=` to
  `$GITHUB_OUTPUT`) → `actions/attest-build-provenance@<sha>` → publish → verify → consume; the attest
  step's `subject-path`, the publish step's `TARBALL` and the verify step's `TARBALL` are ONE expression
  (`steps.pack.outputs.tarball`), the publish run being exactly `node scripts/publish-once.mjs "$TARBALL"` and
  the verify run exactly `node scripts/verify-published.mjs --tarball "$TARBALL" --check version --check
  integrity --check attestation`; `NODE_AUTH_TOKEN` is set on exactly the publish, verify and consume steps
  and `GH_TOKEN` on the verify step only, each `${{ secrets.GITHUB_TOKEN }}`; no `run:` anywhere says `npm
  publish`, `--provenance` or `--access`; no expression is pasted into a `run:` in either release workflow;
  no other workflow is started by a release, holds `id-token` or reads an npm token; the reusable workflow
  has no pull-request trigger; `release-please.yml` runs on pushes to `main` and by hand only,
  checks the two App secrets first, mints with them and hands that token to release-please; every action in
  every workflow is pinned to a 40-hex SHA with a `# v…` comment and every checkout drops its credentials;
  no pull-request event starts a release workflow; pr-title.yml runs the docs-only step with the title as
  data.
- `src/test/releaseConfig.test.ts` — one `node` package at `.`, `include-component-in-tag: false`, not a
  draft; before the first release the manifest is empty and `initial-version` is package.json's version,
  from the release pull request on the manifest names package.json's version — and a manifest that names a
  version must come with release-please's `CHANGELOG.md` section for it (a check on files, not on git tags: a
  CI checkout has none); `repository.url` names this repository (GitHub Packages links the package to the
  repository through it); `publishConfig.registry` is `https://npm.pkg.github.com` and the package's scope is
  `@` + the owner parsed from `repository.url` (the only scope GitHub Packages takes);
  `exclude-paths` is `[".github"]` and a directory; every type pr-title.yml accepts has a changelog section,
  and a section is visible exactly when `docs-only-title.mjs` calls its type releasing (asked by RUNNING the
  script per type, not retyped).
- `src/test/releaseGuard.test.ts` — `.github/scripts/release-guard.mjs --facts`: the release release-please
  cuts for this package.json passes (name and version read from package.json); eleven ways a run is not that
  release are each refused with their own reason; all refusals are listed; malformed facts exit 2; and
  `--facts` mode never writes `$GITHUB_OUTPUT` (pointed at a real file to see it).
- `src/test/verifyPublished.test.ts` — `scripts/verify-published.mjs --facts` over facts built around a REAL
  attestation (`fixtures/verify-published-github-packages.json`, recorded 2026-10-16). **Real:** the verbatim
  `gh attestation verify --format json` output (gh 2.97.0, exit 0, `--repo cli/cli --cert-identity …/deployment.yml@refs/heads/trunk
  --source-ref refs/heads/trunk --deny-self-hosted-runners`) for the asset `gh_2.97.0_linux_armv6.tar.gz` of
  `cli/cli` v2.97.0 — certificate whole, the statement's 21 subjects whole, only `bundle` and `predicate`
  trimmed — and the sha256 and sha512 hashed from that file (the sha256 is the recorded subject digest, which
  is what makes "passes" a real pass). **Built, in the documented shape:** the GitHub Packages packument
  (`view`, whose `dist.integrity` is that file's real sha512) and the packages REST answer (`visibility`) —
  neither can be recorded before a package exists, and this machine's gh login lacks `read:packages`. The
  record passes all four checks; each refusal is that record with ONE fact changed, and names why: a served
  sha512 that is not `dist.integrity`; a `--tarball` that is not the served one (attesting one archive and
  publishing another); no `--tarball` (the integrity check still passes); a packument with no sha512
  integrity; a gh exit ≠ 0 with its stderr; a certificate of another repository/workflow, of another ref, of a
  self-hosted runner; a statement that is not SLSA v1; a subject sha256 that is not the served file's; no
  entry at all; the conditions met by DIFFERENT entries (`no single entry meets every condition`); a
  private package (the message names the owner's click); an unserved version; `--check` runs only what it
  names and is repeatable; usage errors (no version, `v0.1.1`, two versions, an unknown check, a missing
  `--tarball`, `--facts` with `--tarball`) exit 2 with nothing asked; an empty `NODE_AUTH_TOKEN` exits 2
  naming both token kinds before the registry is asked (a 5 s budget, so a script that skips the check shows
  as a kill, not a hang); the sentinel token never appears in any output.
- `src/test/publishOnce.test.ts` — `scripts/publish-once.mjs`: through `--facts`, a version the registry
  already serves publishes NOTHING (exit 0, "the verify step decides…"); a version it does not serve, or an
  answer naming another version, publishes that tarball by name; usage (no tarball, two, a missing file, a
  file named other than `npm pack` names it) exits 2 with nothing on stdout; an empty `NODE_AUTH_TOKEN` exits
  2 naming both token kinds before the registry is asked; the sentinel token is never printed.
- `src/test/npmEnv.test.ts` — `registryEnv` in `scripts/lib/npm.mjs`, run in a `node --input-type=module`
  child with an explicit environment: the user config is exactly two lines derived from the manifest it is
  given (a different scope/registry proves derivation; the real `package.json` gives GitHub Packages and its
  own scope); with a sentinel token set the file holds the literal `${NODE_AUTH_TOKEN}` and never the
  sentinel; an upper-case `NPM_CONFIG_USERCONFIG` and any `npm_config_*` of the parent do not survive; an
  empty or unset token throws before any file is written, and is checked FIRST; the registry is pinned —
  another host, `http`, a double trailing slash, a path or an empty value are refused naming the value seen
  and `https://npm.pkg.github.com`, one trailing slash is accepted and written without it; a scope that is
  not the repository owner is refused naming both; `repositoryOwnerAndName` reads a `git+` prefix, `.git`,
  `github:o/r`, trailing slashes, a string or an object, and refuses other shapes. Still not covered: the
  `publish-once.mjs` retry line ("the registry's answer was not understood …"), which needs a real registry
  answer that is neither a version nor an `E404`.
- `src/test/docsOnlyTitle.test.ts` — coai's `docs-only-title.mjs` tests, ported and adapted to the root
  package: every releasing type over README.md alone refused, plans and research notes included, `docs:`
  passes, pictures are documentation and a picture beside code is code, a `.github`-only change is not
  refused while a README riding with it is, a Markdown-only releasing COMMIT under a `docs:` title is
  refused, unreadable facts exit 2.
- `src/test/packaging.test.ts` gained the `--published` usage cases: no version, `v0.1.0`, `0.1`, two
  versions and a stray positional all exit 2 with nothing on stdout — no step started — and `--published
  0.1.1` with an empty `NODE_AUTH_TOKEN` exits 2 naming both token kinds, before any step.

**actionlint** (`rhysd/actionlint:1.7.12`, whose image carries shellcheck 0.11.0 — shown live by a control
workflow it flagged for SC2086 and an untrusted expression) reports 0 errors over all six workflows. It is
run by hand (`docker run --rm -v <repo>:/repo -w /repo rhysd/actionlint:1.7.12`), not by CI.

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
| **Only a published release reaches the publish job, its `id-token`, its `packages: write` and its `attestations: write`; no npm token exists** (E3.S2, rewritten for GitHub Packages 2026-10-16): `release.yml`'s one trigger is `release: published`; the publish job's permissions are exactly `contents: read`, `packages: write`, `id-token: write`, `attestations: write`, and those three keys are nowhere else in any workflow; `NODE_AUTH_TOKEN` only on the publish, verify and consume steps and `GH_TOKEN` only on verify, each `secrets.GITHUB_TOKEN`; the environment `npm` is kept; no pull-request event starts any release workflow; no expression pasted into a `run:`; no npm token named in any workflow, script or `package.json` | covered | `src/test/releaseWorkflows.test.ts`. Teeth, each a one-edit break of the real file observed red and restored `cmp`-identical to a saved copy: `packages: write` added to the guard job (*release.yml: where "packages" is granted*); `NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}` on the publish step (2 red: *a file still names the npm token the publish no longer uses*, and the one-credential test); `environment: npm` removed (red: *Expected values to be strictly equal*); earlier, in the E3.S2 round: a `pull_request:` trigger (2 red), the tag name pasted into the guard's `run:` (2 red) |
| **The publish job packs ONE tarball and attests, publishes and verifies that same tarball** (2026-10-16): guard → `npm test` → pack (`id: pack`, the job's only `npm pack`, `tarball=` to `$GITHUB_OUTPUT`) → `actions/attest-build-provenance@<sha>` → `publish-once.mjs` → `verify-published.mjs --tarball` → the published consumer fixture; the attest `subject-path`, the publish `TARBALL` and the verify `TARBALL` are ONE expression, `steps.pack.outputs.tarball`; setup-node's `registry-url` and `scope` are `package.json`'s `publishConfig.registry` and the scope of its name | covered | `src/test/releaseWorkflows.test.ts`. Teeth, each observed red and restored identical: the attest step moved after the publish step (*order: guard 2, test 4, pack 5, attest 7, publish 6, verify 8, consume 9*); `registry-url: https://registry.npmjs.org` (*registry-url is not package.json's publishConfig.registry*); the publish step's `TARBALL` another path (*Expected values to be strictly equal*); a second `npm pack` in the verify step's run (2 red: *the publish job runs npm pack in 2 steps — exactly one tarball may exist*, and the exact-run test) |
| **A publish that already happened is not repeated, and the verify step still decides** (2026-10-16): a version the registry serves publishes NOTHING (exit 0); one it does not serve, or an answer naming another version, publishes that tarball by name; usage and an empty token exit 2 before the registry is asked; the token is never printed | covered | `src/test/publishOnce.test.ts`, red first: *Cannot find module '…/scripts/publish-once.mjs'* in all five. Teeth: `decide` always `publish` (B1 red: the served line did not match); always `skip` (2 red: the not-served line did not match); `registryEnv` moved after the registry question (*a registry question reached stdout before the token was checked*) |
| **`registryEnv` writes the token REFERENCE, never the value** (2026-10-16): two lines derived from the manifest; `${NODE_AUTH_TOKEN}` literal; `npm_*` of any case dropped; an empty token refused before any file is written | covered | `src/test/npmEnv.test.ts`, red first: *registryEnv is not a function*. Teeth: the token value written instead of the reference (3 red: *the user config holds the token value*); the empty-token refusal dropped (red: *an empty token must not be accepted*); the registry pin removed (red: *registry "https://registry.example.test/npm/" was accepted*); the scope check removed (red: *a scope of another owner was accepted*); each restored identical |
| **release-please proposes with the App token, only from `main`**; pr-title.yml's docs-only step gets the title as data | covered | `src/test/releaseWorkflows.test.ts`. Teeth: `token: ${{ secrets.GITHUB_TOKEN }}` (red); a `pull_request:` trigger (2 red); `PR_TITLE` removed from the docs-only step (red) — each restored by SHA-256 |
| **The first release is 0.1.0, tagged `v0.1.0`**: empty manifest + `initial-version` = package.json's version; a manifest naming a version comes with release-please's CHANGELOG.md section; one `node` package at `.`, no component, not a draft; visible changelog sections exactly the releasing types, and every title type has one | covered | `src/test/releaseConfig.test.ts`. Teeth: the sibling bootstrap `{".": "0.1.0"}` (*the manifest says 0.1.0 was released, but CHANGELOG.md has no section for it — release-please would cut the version after 0.1.0*); `initial-version` removed (*nothing is released yet, so release-please cuts initial-version — it must be package.json's 0.1.0*); `docs` made visible (*"docs" is visible in the changelog, but docs-only-title says it does not release*); the `test` section removed (*a title type with no changelog section*); `include-component-in-tag: true` (red) |
| **The release guard** refuses every run that is not the release release-please cut for this package.json, listing every reason; `--facts` never writes `$GITHUB_OUTPUT` | covered | `src/test/releaseGuard.test.ts`. Teeth: the author check made always-true (*a release a person made by hand was not refused: release-guard: ok — @oleksandrdubyna88/vscode-webview-kit@0.1.0*); the main check made always-true (*a commit that is not on main was not refused*) |
| **What GitHub Packages serves is verified, not assumed**: the version; the served tarball's sha512 is `dist.integrity` and the attested file's (served = attested); `gh attestation verify` of the SERVED bytes, read back — ONE entry with this repository's `release.yml` at `refs/tags/v<version>`, a GitHub-hosted runner, SLSA v1, the served file's sha256 as a subject; the package is public — over facts built around a real attestation recorded from `cli/cli` | covered | `src/test/verifyPublished.test.ts`. Red first (19 tests; the old checks ran over the new shape): *verify-published: gh@2.97.0 FAILED — provenance: gh@2.97.0 carries no SLSA v1 provenance (dist.attestations)*, *--check is one of version, provenance, signatures or all, not "integrity"*, and for the empty token a kill after 5 s on the first *not served yet* line. Teeth, each observed red and restored identical: the `subjectAlternativeName` condition removed (*verify-published: ok — gh@2.97.0: attestation*); the `runnerEnvironment` condition (2 red); the `sourceRepositoryRef` condition (red); the subject sha256 condition (red); the `local.sha512 === served.sha512` comparison (red: *verify-published: ok — gh@2.97.0: integrity*); `.some(meetsAll)` replaced by per-condition "any entry" (red: the split-entries test); `registryEnv` after the registry question (red: *not served yet (attempt 1/12)*) |
| **Documentation alone never opens a release** at a ROOT package: a releasing title or commit whose files, `.github` aside, are all Markdown or pictures is refused | covered | `src/test/docsOnlyTitle.test.ts` — red first against coai's script copied verbatim: 5 of 8 red, *"feat: a new page" would open a release for a README: No package would be released on documentation alone.* (`0 !== 1`) — coai's `pkg + '/'` prefix can never match the root `.`, so the copy was inert here. Green after the adaptation (`isUnder`, `exclude-paths` dropped first) |
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
- **The release itself is not run here, and nothing has been published** (0.1.0 never reached a registry;
  0.1.1 is the first publish). What only a real release can show: that the App's token mints and
  release-please opens its pull request on `main` (and that `contents: read` on that job is enough, every
  write being the App's); that merging it tags the version and the published release starts `release.yml`;
  that the environment `npm`'s tag rule refuses other refs (a GitHub setting the suite cannot see); **the
  real publish** — that `npm publish <tarball>` with the job's `GITHUB_TOKEN` is accepted by GitHub Packages;
  **the real attestation of this package** — that the attest step signs and stores it; **the GitHub Packages
  packument shape** — that `npm view --json` carries `dist.integrity` there (the fixture's `view` is built in
  the documented shape); **the packages REST answer** (`gh api /users/<owner>/packages/npm/<name>`, built in
  the fixture) and **visibility inheritance** — whether a package a workflow creates with `GITHUB_TOKEN` is
  public, as one documentation page says, or private, as another says; **whether `npm deprecate` works
  against GitHub Packages**; **whether `packages: write` reads back** and `attestations: write` reads
  attestations, as GitHub's cumulative levels say; that `verify-published.mjs`'s retry covers the registry's
  propagation; and that `--published` downloads and consumes the real tarball. Those are DoD part B and
  POST_DEPLOY.md, run at the first release.
- The gathering halves of `verify-published.mjs` and `publish-once.mjs` (`npm view`, `npm pack
  <name>@<version>`, `gh attestation verify`, `gh api`, `npm publish`) are not run by the suite: they need a
  real GitHub Packages package and a token. `registryEnv` is held in a child process with a sentinel token,
  and what npm does with the `${NODE_AUTH_TOKEN}` reference is npm's (measured once by hand: an unset
  variable in that line does not break other npm commands).
- The workflow tests read the files through a subset reader, not GitHub's parser; actionlint, run by hand,
  is the check that GitHub's schema accepts them, and the first real runs are the check that GitHub
  behaves as the files say.
- `docs-only-title.mjs`'s `--pr` mode (the facts from `gh api`) runs only in pr-title.yml; the suite feeds
  it facts directly, as coai's suite does.

## When it runs

On every pull request and push to `main`, in CI.

`npm test` runs everything above, `pack-and-consume` included (both modes, about 12 s of a 20 s suite here).
CI's `build-test` job runs `npm test` on both platforms, and `ci.yml` also calls the reusable
`pack-and-consume.yml`, which runs `npm run pack-and-consume` alone on both platforms — the job
`release.yml` calls again, at the tag, before it publishes. `release.yml` runs the suite once more in its
publish job (`npm publish <tarball>` runs no lifecycle script, so `prepublishOnly` does not run again), then
packs once, attests, publishes once, and runs POST_DEPLOY.md's checks 1, 2, 3 and 5 against what GitHub
Packages serves (check 4, visibility, needs `read:packages` and is a person's).
