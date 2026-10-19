# PLAN — kit 0.2.0: Tabs, DataTable, RecommendationCard, theme tokens, and a Storybook

> Status: **in progress, 2026-10-18** — built on `feat/kit-k1-components`, rebased onto `main` @ `d8a1e2d` (kit 0.1.1, published to GitHub Packages on 2026-10-17): the components, the stylesheet, the Storybook, the axe and contrast checks, the consumer fixture's webview entry, and §4.6a (the owner's review of the E18 mockup, 2026-10-15: no table ever scrolls sideways — items 25–28, the layout check, as built in §11). **Open:** the code round, the merge, and the 0.2.0 release (release-please's pull request; §7). Plan round `proceed` 2026-10-12. Scope: a new `src/components/` module with its
> own package entry (`./components`) and stylesheet (`./components.css`), a Storybook (devDependencies only),
> axe and contrast checks in CI, and the docs. This is story **E18.K1** of wsl_care's epic E18
> (`wsl_care · todo/PLAN_disk_health.md` §3.4 and its E18 table, issue oleksandrdubyna88/wsl_care#87),
> started on the owner's go of 2026-10-12.
>
> Paired plans: `wsl_care · todo/PLAN_disk_health.md` §3.4 (the same table as §2 below, written there first) and
> this repository's [PLAN_extract_the_kit.md](PLAN_extract_the_kit.md) (0.1.0, which never reached a registry; 0.1.1 is the first published version), the first step of the order.

## 1. Goal

wsl_care's full view (its E18.W1) needs tabs that carry a status, a table people can sort, search and reveal a
redacted value in, and a card that says what to do about the worst problem — in a webview whose CSP is
`default-src 'none'; script-src 'nonce-…'; style-src 'nonce-…'` (`wsl_care · src_vs_code/src/panel/panelHtml.ts:60`,
at `413242c4`) and whose page script is run by a harness that refuses `innerHTML`, `style`, and every tag,
attribute and event it does not model (`wsl_care · src_vs_code/src/test/support/pageHarness.ts:30`, `:33`, `:36`,
`:200`). Built in wsl_care it would be a copy the next extension makes again; built here it is one
implementation both extensions bundle.

What must be true when this plan is done:

1. `@oleksandrdubyna88/vscode-webview-kit/components` exports `createTabs`, `createDataTable`,
   `createRecommendationCard` and the status tones; `@oleksandrdubyna88/vscode-webview-kit/components.css` is
   their one stylesheet. Both are importable by a consumer's esbuild bundle for the WEBVIEW (`platform:
   'browser'`) — nothing in the components' import closure reaches `node:` or `vscode`.
2. The components build DOM with `createElement` / `textContent` / `setAttribute` only — no `innerHTML`, no
   `style`, no inline handler — and colour comes from CSS classes and theme tokens mapped onto VS Code's
   `--vscode-*` variables, so light, dark and high-contrast themes are VS Code's to set.
3. Behaviour is tested by RUNNING the components, against a strict fake DOM AND against jsdom; every
   component × state is in a Storybook (`@storybook/html-vite` + `@storybook/addon-a11y`) with light / dark /
   high-contrast × three font sizes; axe-core runs over every one of those states in CI, and the theme
   tokens' contrast is checked against representative values of VS Code's built-in themes.
4. The package keeps ZERO runtime dependencies; `files` stays `dist` + the digests bin; no Storybook file ships.
5. The first version wsl_care can pin is 0.2.0 (§7).

Constraints (`.agents/PROJECT.md`): pure modules never import `vscode` or `node:`; a page script is tested by
running it; user-facing text is English; no runtime dependency. No wsl_care-specific component and no domain
words: every label, unit, number format, sentence and revealed value is the consumer's.

## 2. The boundary with wsl_care (the same table as `wsl_care · todo/PLAN_disk_health.md` §3.4)

| Item | `dew_flow_vscode_kit` builds | wsl_care builds |
|---|---|---|
| `Tabs`, `DataTable`, `RecommendationCard`, theme tokens; the display controls and Help viewer (exist) | the components, their CSS (classes only), their tests, axe checks, the Storybook (every component × state × light / dark / high contrast × three font sizes), release 0.2.0 | nothing of the components — it consumes them |
| the data shown, the units, the redaction, the reveal, the recommendation's words | nothing (consumer-supplied callbacks and strings) | everything (E18.W1–W3; the daemon makes the words) |
| the order | 0.1.1 on GitHub Packages (the first publish; its E3, [PLAN_extract_the_kit.md](PLAN_extract_the_kit.md)) → K1 (this plan) → 0.2.0 on GitHub Packages | W0 starts only after 0.2.0 is published (or the kit's `pack-and-consume` tarball as a bridge, never committed) |
| disjoint | no wsl_care-specific component, no `vscode` API in the webview components | no copy of a kit component, ever (`common.reuse-first`) |

The table is complete, not a list of examples: anything not in the first column's left cell is wsl_care's.
Two consequences for wsl_care's W0 that this plan makes explicit rather than leaving to discovery:

- **Its strict harness must widen by exactly the DOM surface of §4.3** — `input`, `keydown`, `focus()`, and the
  attributes `id`, `tabindex`, `aria-*` (already allowed) — each widening a RED test there, as its W0 row says.
- **The existing display controls' page scripts write `document.body.style`** (`src/display/zoom.ts:67`,
  `src/display/tone.ts:110-112`), which wsl_care's harness refuses. That is CSSOM, which a nonce-only
  `style-src` does not block, but it is wsl_care's decision whether its harness models it; K1 does not rewrite
  those controls (they are byte-compatible with ConnectOtherAIs, `research/architecture.md` § The display module).

## 3. Where things are today (verified 2026-10-12, `main` @ `e4813be`)

- The package has ONE entry: `src/index.ts:1-116`, exported as `"."` (`package.json:13-19`), which re-exports
  `nonce` (`src/index.ts:79`) — and `src/webview/nonce.ts` imports `node:crypto`. A webview bundle that imported
  the root entry would pull `node:crypto` into a browser build (esbuild refuses to resolve it for
  `platform: 'browser'`). Hence a second entry (§4.2).
- `package.json` has `"sideEffects": false` (`:27`), which is untrue of a stylesheet: a bundler that honours the
  field for CSS drops a bare `import '…/components.css'`. §4.2 changes it. *(As built: the premise that ESBUILD drops
  it was refuted by the break-it — esbuild 0.28.2 emitted the CSS with `sideEffects: false` restored; see §11.)*
- `tsconfig.json:11` is `lib: ["ES2022"]` on purpose (no DOM globals in pure modules). The components therefore
  take the document as a PORT (§4.3) — which is also what makes them testable without a global `document`.
- `tsconfig.build.json:10` excludes `src/test` from `dist/`; the gallery (§5.1) lives under `src/test/` so it
  never ships.
- `scripts/pack-and-consume.mjs:69` requires `dist/index.js` + `dist/index.d.ts`, and `:173` refuses anything
  under `dist/` that is not `.js` / `.d.ts` — the CSS must be admitted there, derived from the manifest's
  `exports` rather than retyped. Its bundle step (`:225-249`) bundles for `platform: 'node'` only; a webview
  entry for `platform: 'browser'` is added (§6).
- `src/test/architecture.test.ts:20` (host allowlist: `nonce.ts`) and `:103` (`PAGE_MODULES`, whose import
  closure must not reach a host module) — the components join that list, and the new entry's closure must not
  reach `nonce.ts` while the root entry's still must.
- `src/test/exports.test.ts:15-47` pins the root entry name by name; the components entry gets its own pinned
  list, and the root list does not change.
- `src/test/pageHarness.ts` runs STRING page scripts in `node:vm`; it stays as is. The components are TypeScript
  functions over an injected document, so their strict fake is a new `src/test/fakeDom.ts` (§5.2).
- CI (`.github/workflows/ci.yml`) runs conventions check, plan lifecycle, typecheck, lint, test, build and
  `npm pack --dry-run` on ubuntu-latest and windows-latest, plus the reusable `pack-and-consume.yml`.

## 4. Design

### 4.1 DOM builders, not HTML strings — decided

The consumer's pages build their DOM in the webview from posted data (`panelHtml.ts`' shell carries no data; the
page script fills it). A string renderer would need `innerHTML` in the webview — refused by wsl_care's harness —
or a host-rendered page, which is not how wsl_care's full view works. So each component is a function
`(doc, options) → view`, run in the webview, that creates elements with `createElement`, writes text with
`textContent` (never parsed), and wires its own listeners. No string ever becomes markup, so the kit's escapers
are not needed here; `src/test/scriptInterpolation.test.ts` keeps scanning every shipped source.

### 4.2 The package surface

| Specifier | File | Holds |
|---|---|---|
| `@oleksandrdubyna88/vscode-webview-kit` | `dist/index.js` | unchanged — the 0.1.x host + page API |
| `…/components` | `dist/components/index.js` (+ `.d.ts`) | `createTabs`, `createDataTable`, `createRecommendationCard`, `STATUS_TONES`, their types |
| `…/components.css` | `dist/components/components.css` | the theme tokens and every component rule |

- `exports` gains `"./components"` (`types` / `require` / `default`) and `"./components.css"`.
- `sideEffects` becomes `["*.css"]` — the stylesheet is a side effect, every JS module stays side-effect-free.
- `npm run build` copies `src/components/components.css` into `dist/components/` after `tsc`
  (`scripts/copy-css.mjs`, deleting nothing outside `dist/`).
- The components entry imports nothing outside `src/components/` — its closure is the component files and their
  helpers (`dom.ts`, `checks.ts`, `status.ts`, `tableOrder.ts`); the architecture test holds it (§5.2, item 21).

A consumer (wsl_care's `src/webview/fullView.ts → media/full.js` + `media/full.css`):

```ts
import { createDataTable, createTabs, createRecommendationCard } from '@oleksandrdubyna88/vscode-webview-kit/components';
import '@oleksandrdubyna88/vscode-webview-kit/components.css'; // esbuild emits it beside the JS as full.css
```

**How the emitted stylesheet gets past the CSP** (gate, plan round, finding 0): the consumer's shell links it
with the render's nonce — `<link rel="stylesheet" nonce="…" href="<webview URI of full.css>">` — exactly as
wsl_care's shell already links `media/panel.css` (`wsl_care · src_vs_code/src/panel/panelHtml.ts:61`). The kit's
stylesheet asks for nothing more than that nonce: no inline `style`, no `url()`, no `@import` (held by §5.2 item
17). README "Use" shows the link. That a browser then honours the nonce is the browser's, and is listed in §8.

### 4.3 The DOM port — what the components touch, and nothing else

`src/components/dom.ts` declares the slice of the DOM the components use, F-bounded so that a real `Document`
fits without a cast and the elements come back typed as the consumer's own (`HTMLElement`):

```ts
export interface KitEvent { readonly key?: string; preventDefault(): void }
export interface KitElement<E> {
  readonly tagName: string;
  textContent: string | null;
  className: string;
  hidden: boolean | string;           // lib.dom types it boolean | "until-found"; the kit writes booleans
  setAttribute(name: string, value: string): void;
  appendChild(child: E): unknown;      // re-appending an attached child MOVES it — how a sort reorders rows
  addEventListener(type: 'click' | 'keydown' | 'input', listener: (event: KitEvent) => void): void;
  focus(): void;
}
export interface KitDocument<E> { createElement(tag: KitTag): E }
```

Measured before writing this plan (scratch check, TypeScript 6.0.3, `lib: ES2022, DOM`, `module: commonjs` and
`node16`): `make(document)` against this shape compiles, infers `E = HTMLElement`, and the result appends to
`document.body` with no cast. An input's `value` is read through an `unknown` widening and a `typeof` check, never
a cast to a DOM type.

**The surface, which is also what wsl_care's harness must model** (§2):

| What | Used |
|---|---|
| tags (`KitTag`) | `div`, `span`, `strong`, `p`, `ul`, `li`, `button`, `input`, `table`, `thead`, `tbody`, `tr`, `th`, `td` |
| attributes (`setAttribute`) | `role`, `id`, `type`, `tabindex`, `scope`, `colspan`, `aria-selected`, `aria-controls`, `aria-labelledby`, `aria-label`, `aria-sort`, `aria-hidden`, `data-kit-*` — never `style`, `on*`, `src`, `href` |
| members | `className`, `textContent` (strings only), `hidden`, `focus()`, an input's `value` (read, and written by `filter()` so the box shows the query) |
| events | `click` (tabs, sort and reveal buttons), `keydown` (the tablist: arrows, Home, End), `input` (the search box) |

### 4.4 The status tones

`STATUS_TONES = ['neutral', 'info', 'ok', 'warning', 'critical']`, and a `StatusMark` is `{ tone, word }`. The
WORD is required and non-empty wherever a tone is shown — colour is never the only signal. A tone paints a glyph
(`aria-hidden="true"`: `•`, `ℹ`, `✓`, `⚠`, `✕`) and a border in the tone's colour; the word is drawn in the normal
foreground, so it never depends on a tone colour's contrast. ("Tone" here is a STATUS tone; the existing ± text
tone in `src/display/tone.ts` is a different thing, and the type is named `StatusTone` to keep them apart.)

### 4.5 `Tabs`

```ts
createTabs(doc, {
  idPrefix: 'full',                                  // [a-z][a-z0-9-]*, unique per page: tab and panel ids derive from it
  label: 'Sides',                                    // the tablist's aria-label
  tabs: [{ id: 'wsl', label: 'WSL: Ubuntu', content, status: { tone: 'warning', word: '2 warnings' } }, …],
  selected: 'wsl',                                   // optional; the first tab otherwise
  onSelect: (id) => …,                               // optional; called on a USER's selection only
}) → { root, select(id), selected(), setStatus(id, mark | null) }
```

The WAI-ARIA tabs pattern with automatic activation: `div role=tablist aria-label`, each tab a
`button role=tab type=button` with `id`, `aria-controls`, `aria-selected`, and a roving `tabindex` (`0` on the
selected tab, `-1` elsewhere); each panel `div role=tabpanel aria-labelledby tabindex=0`, hidden unless selected,
holding the consumer's `content` element. Keys on the tablist: ArrowRight / ArrowLeft move and select (wrapping),
Home / End the first / last, each with `preventDefault` and `focus()` on the new tab; any other key does nothing.
A click selects. `setStatus` replaces one tab's mark live (wsl_care's tones change as data arrives) or removes it.
Refused with a `TypeError` naming what: no tabs, a repeated or malformed id, an empty label, a `selected` that is
not a tab, a mark with an unknown tone or an empty word.

### 4.6 `DataTable`

```ts
createDataTable(doc, {
  label: 'Processes',                                // the table's aria-label
  columns: [
    { key: 'pid', header: 'PID', value: (r) => r.pid, align: 'end' },
    { key: 'held', header: 'Held', value: (r) => r.heldBytes, format: (v) => toMiB(v), align: 'end' },   // the consumer's unit
    { key: 'program', header: 'Program', value: (r) => r.program },
  ],
  rows,
  search: { label: 'Search processes' },             // optional
  reveal: { header: 'Command line', button: (row) => `Show the command line of ${row.program}`, onReveal: (index, request) => post({ type: 'reveal', index, request }), waitingText: 'Waiting…' }, // optional
  emptyText: 'No process matches.',                  // optional, English default
  sort: { key: 'held', direction: 'descending' },    // optional initial sort
}) → { root, setRows(rows), reveal(index, text, request) → boolean, sortBy(key, direction), filter(query), order(), dispose() }
```

- **Values and formats are the consumer's.** `value(row)` is `string | number | null` and is what sorts;
  `format(value, row)` is what shows (default `String(value)`); `null` is ABSENT, shown as `—`, never passed to
  `format`, and sorted last in both directions (`common.coding-style`: absent is not zero). Numbers compare
  numerically, strings by `Intl.Collator('en', { numeric: true, sensitivity: 'base' })`, numbers before strings,
  ties by the original index (stable).
- **Sort by click / Enter / Space.** A sortable header is `th scope=col aria-sort` holding a `button type=button`
  (the header text and an `aria-hidden` ▲/▼); `aria-sort` is `ascending` / `descending` on the sorted column
  and `none` on the other sortable ones; a non-sortable column has no button and no `aria-sort`. A click sorts
  ascending, a second click on the same column descending, and so on. Enter and Space reach the button as a
  click — the browser's own activation behaviour for `<button>` — so the kit adds no key handler (a second one
  would sort twice); the tests prove the header IS a `button type=button` and that its click sorts, and the
  Storybook is where a real keyboard is used (§8 says what that does not prove).
- **Search.** An `input type=search aria-label` above the table; on `input`, rows whose SHOWN text (the formatted
  cells, case-insensitive, trimmed query) does not contain the query are `hidden`. A `div role=status` says
  `Showing 3 of 10 rows.` (English default; `countText(shown, total)` overrides), and an empty result shows one
  row spanning every column with `emptyText`.
- **Reveal posts only an index, and the hidden text is never in the DOM before it is revealed.** The reveal
  column holds, per row, a `button type=button` with the consumer's `button(row)` text as its `aria-label` and
  `Show` as its text; a click calls `onReveal(index, request)`: the row's index in the `rows` the
  consumer gave (not its position after a sort or a search). The kit never receives the hidden text until the
  consumer calls `reveal(index, text, request)`, which replaces THAT row's button with the text and answers `true`. **A reveal
  is the answer to a request** (code round, 2026-10-18): a click records the row index as pending in the CURRENT rows;
  `reveal(index, text, request)` applies only when `request` is the row's CURRENT pending request (an opaque id, unique per click for the life of the table, `<generation>:<n>`, carrying no row data) and spends it, and otherwise answers `false` and changes nothing
  (no throw: a slow host reply must not crash the page). `setRows` drops every revealed text AND every pending request —
  a late reply for the old row 3 never lands on the new row 3. A revealed text is searchable like any shown text, until
  `setRows` drops it.
- **A late reply is never an error** (security round, 2026-10-19): `reveal(index, text, request)` answers `false` and changes nothing for a row that is gone because `setRows` shrank the rows, a request that is not current, and any reply after `dispose()`. The `TypeError`s are the programmer errors only: no reveal column, an index that is not a whole number of 0 or more, a text or a request that is not a string. `setRows` is all or nothing: the new row views are built first (a consumer's `value()`/`format()` can throw there) and only then replace the old ones, so a throw leaves rows, revealed texts and pending requests exactly as they were. `dispose()` drops the pending requests, makes `reveal` answer `false`, makes a click on a reveal button tell nobody and `setRows`/`sortBy`/`filter` no-ops. The only reset of a waiting row is `setRows` (or `dispose`); a host that cannot answer answers `reveal(index, 'not available', request)`; there is no `cancel()`. The `button(row)` text is in the page before any reveal: never the hidden value.
- Refused with a `TypeError`: no columns, a repeated or malformed key, an empty header or label, a
  `sort.key` that is not a sortable column, `reveal(index, …)` without a reveal column or with an index that is not a whole number of 0 or more (an index with no row NOW is a late reply: `false`), a
  non-string revealed text, a `filter(query)` whose query is not a string.

### 4.6a `DataTable` fits its box — never a horizontal scroll (the owner, 2026-10-15)

The owner approved the E18 mockup (a scratch folder outside every repository) with three changes; one of them
is the kit's: **no table scrolls sideways, small ones above all** — columns shrink and wrap, headers are short, and
where that is not enough a row breaks onto several lines; a scroll bar is never the answer. (The other two — cards in
one row of one height, and a distro picker on wsl_care's WSL tab — are the consumer's layout, E18.W1.)

- **The table is never a scroll container and never wider than its box.** `.kit-table` is a CSS size container
  (`container: kit-table / inline-size`), so what follows reads the TABLE's own width, not the window's: a table in a
  narrow card adapts at 1920 px too. `.kit-table__grid` is `width: 100%`; a cell breaks a word only as a last resort
  (`overflow-wrap: anywhere`); a header breaks only between words (`overflow-wrap: break-word` — never "Ru|ns");
  an `align: 'end'` cell stays on one line only while the table is wider than `30em`.
- **Stacked rows below a width.** `createDataTable(doc, { …, stack: 'narrow' | 'medium' | 'wide' | 'never' })` —
  default `'medium'` — adds `kit-table--stack-<value>`; below `30em` / `40em` / `60em` of the table's own width each
  row shows as "label: value" lines: every body cell carries `data-kit-label` = its column's header (set with
  `setAttribute`, `data-kit-*` is already in §4.3's set) and the stylesheet draws it with
  `td[data-kit-label]::before { content: attr(data-kit-label) ': ' }`. The header row becomes a wrapped row of the
  sortable headers' buttons after the words `Sort by` (a CSS `::before`, so it is not in the accessible name), so
  click / Enter / Space sorting keeps working; a non-sortable header is hidden there, because its cells carry its name.
  The reveal cell and the empty-result row stack like any other cell; the empty row shows no label.
- **Why not "fewer columns".** Hiding a column hides data the consumer chose to show; stacking keeps every value and
  still never scrolls. A consumer who wants fewer columns passes fewer columns.
- **Proved in a real browser, not asserted** — jsdom has no layout (§4.10). `scripts/layout-check.mjs` (no
  dependency: Node's own `WebSocket` drives Chrome over the DevTools protocol, the viewport set by
  `Emulation.setDeviceMetricsOverride`, so 300 px is laid out at 300 px rather than cropped) renders every gallery
  case into one static page with `components.css` and the theme fixtures, at **300 / 1280 / 1920 px × the four themes
  × three sizes**, each case also inside a deliberately narrow (`18em`) box, and fails on: a page wider than the
  viewport; any element whose content is wider than its box (`scrollWidth > clientWidth`, which is what a scroll bar
  or spilled text is); a table wider than its parent; a cell whose content spills out of it. Chrome is found from
  `CHROME_PATH`, then the platform's usual install paths; none found is a RED run that says so, never a skip. CI runs
  it on ubuntu (Google Chrome is on GitHub's image) in the `storybook` job. Its profile lives in a git-ignored
  `testsToDelete-layout-check/` that the script removes in a `finally`.
  **Release boundary:** the layout check runs only in CI's `storybook` job (ubuntu, Chrome), never in `release.yml`, and `main` has
  NO branch protection (checked 2026-10-18: `gh api repos/oleksandrdubyna88/dew_flow_vscode_kit/branches/main/protection` answers 404).
  A release therefore carries a green layout check only because pull requests - the release-please one included - are merged by
  hand, and only when every check, `storybook build` included, is green. That is a working rule, not an enforcement; making
  `storybook build` a required check is the owner's setting (README, *What the owner creates once*, recommends it).

### 4.7 `RecommendationCard`

```ts
createRecommendationCard(doc, {
  tone: 'warning', word: 'Warning',
  sentence: 'Memory is low: 6 % available. Drop caches to free about 2.1 GiB.',
  action: button,                                    // optional: ONE element the consumer built, which must be a BUTTON
  evidence: ['WSL RAM available 6 %', 'Swap 92 % used'],   // optional
  evidenceLabel: 'Why',                              // optional, English default 'Evidence'
}) → root
```

`div.kit-rec.kit-rec--<tone>`: a header line with the tone glyph (`aria-hidden`) and the word (`strong`), the
sentence (`p`), the action slot (`div`, holding the consumer's button as given — the kit wires nothing on it), and
the evidence (`p` label + `ul` of `li`). Refused: an unknown tone, an empty word or sentence, an action that is
not a `BUTTON`, an empty evidence entry.

### 4.8 Theme tokens and the stylesheet

`src/components/components.css`, classes only, every size in `em` so the ± text size scales it:

- **Tokens** are declared on each component root (`.kit-tabs, .kit-table, .kit-rec`) — not on `:root`, because a
  custom property holding `var()` resolves where it is DECLARED, and a Storybook matrix cell (or a consumer's
  sub-panel) that sets its own `--vscode-*` values must be followed. Each maps onto a `--vscode-*` variable:
  `--kit-fg` ← `foreground`, `--kit-muted-fg` ← `descriptionForeground`, `--kit-bg` ← `editor-background`,
  `--kit-border` ← `panel-border`, `--kit-focus-mark` ← `focusBorder`, `--kit-tab-fg` / `--kit-tab-active-fg` /
  `--kit-tab-active-mark` ← `panelTitle-*`, `--kit-input-fg` / `-bg` / `-border` ← `input-*`,
  `--kit-row-hover-bg` ← `list-hoverBackground`, `--kit-link-fg` ← `textLink-foreground`, and the tones
  `--kit-tone-neutral-mark` ← `descriptionForeground`, `--kit-tone-info-mark` ← `editorInfo-foreground`,
  `--kit-tone-ok-mark` ← `charts-green`, `--kit-tone-warning-mark` ← `list-warningForeground` falling back to
  `editorWarning-foreground`, `--kit-tone-critical-mark` ← `list-errorForeground` falling back to
  `errorForeground`. Why these and not the obvious ones — measured against the resolved theme values of §5.4
  before writing this: Light Modern's `testing.iconPassed` is `#73C991` and its `editorWarning.foreground`
  `#BF8803`, both below 3:1 on its white editor; `list.warningForeground` / `list.errorForeground` are UNSET in
  both high-contrast themes (`listColors.ts:94`, `:97`, hcDark/hcLight `null`), so VS Code emits no variable
  and the fallback is what paints there.
- **Light / dark / high contrast are VS Code's**: the variables change with the theme. High contrast adds
  `--vscode-contrastBorder` / `--vscode-contrastActiveBorder` outlines on the selected tab, the focused control
  and the card, under `.vscode-high-contrast` / `.vscode-high-contrast-light` (an ancestor class, so a Storybook
  matrix cell can carry it).
- **Focus is always visible**: `:focus-visible` draws `--kit-focus-mark`.
- No `url(`, no `@import`, no `!important`, no `expression` — the stylesheet is loaded under a nonce and must
  fetch nothing.
- **Naming convention the contrast check derives its pairs from** (§5.4): a token ending `-fg` is TEXT and needs
  4.5:1 against `--kit-bg` (or against its own `-bg` sibling when one exists); a token ending `-mark` is a
  NON-TEXT indicator (focus, the selected tab, a tone) and needs 3:1 against `--kit-bg`. `-border` and `-bg`
  tokens are the theme's own decoration (Light Modern's `panel.border` `#E5E5E5` and `input.border` `#CECECE` are
  VS Code's choice on white) and are not held to a ratio — what identifies a control here is its text and the
  `-mark` colours, never a border alone.

### 4.9 The Storybook

- `@storybook/html-vite` with `@storybook/addon-a11y`, devDependencies only. `.storybook/main.ts` (stories
  `stories/*.stories.ts`, telemetry disabled), `.storybook/preview.ts` (two toolbar globals — theme: light,
  dark, high-contrast dark, high-contrast light; size: 11 px, 13 px, 18 px — and a decorator that sets the
  body's `vscode-*` theme class and the `--vscode-font-size` / font size), `.storybook/vscode-themes.css`
  (representative `--vscode-*` values per theme, §5.4, each with its source).
- **One source of truth for the states**: `src/test/gallery/*.ts` — for each component, a list of
  `{ id, title, render(doc) }` cases (Tabs: default, a status per tone, many tabs, the second selected; DataTable:
  unsorted, sorted ascending / descending, with absent values, searched with hits, searched with none, revealed,
  without search or reveal; RecommendationCard: each tone, with and without action and evidence). Storybook's CSF
  files (`stories/*.stories.ts`) export one story per case — `export const SortedDescending = story('dataTable',
  'sorted-descending')` — because CSF is indexed STATICALLY and cannot loop; `src/test/stories.test.ts` holds the
  exports equal to the gallery, both ways.
- **The matrix**: each component also has a `Matrix` story — every state × the four themes × three sizes on one
  page, each cell a wrapper carrying the theme class and size class — so "every component × state × theme ×
  size" is one screen and one axe run in the browser panel.
- **The existing parts**: `Display controls` (the ± size and ± tone markup from `zoomControlHtml` /
  `toneControlHtml` at −5, 0, +5, with their CSS) and `Help viewer` (`renderHelpPage` over a small catalog: English,
  a translation, a stale translation, a fallback — in an `iframe srcdoc`, with a story-only `acquireVsCodeApi`
  stub under the page's own nonce). Rendered as they are; not rewritten.
- `npm run storybook` (dev) and `npm run build-storybook` (static, into git-ignored `storybook-static/`).

### 4.10 axe in CI — the route, and why

**Chosen: axe-core over jsdom, inside `npm test`.** `src/test/axe.test.ts` renders every gallery case into a
jsdom document with the kit's stylesheet, injects `axe.source` into that window, and asserts zero violations for
the WCAG 2.x A/AA rule tags. It is the cheapest robust route: no browser download, no second test runner, it runs
in the job that already exists on ubuntu AND windows, and it reads the same gallery Storybook shows, so a state
added to Storybook is a state axe checks. A companion test feeds axe a deliberately broken case (a tab with no
name) and asserts it IS reported, so a dead axe cannot pass vacuously (`common.testing`).

Refused alternatives: the Storybook test-runner (Playwright) needs a browser installed on every CI leg — minutes
and a large download per run, and a second runner whose failures are about browsers; `@storybook/addon-vitest`
needs the same browser plus Vitest beside `node --test`.

What jsdom cannot judge: rules that need layout or rendering — colour contrast above all — come back
"incomplete", not "passed". Contrast is covered separately by §5.4 (the tokens against representative theme
values, computed); the Storybook a11y panel shows axe's contrast verdict in a real browser, by hand.

### 4.11 Dependencies (devDependencies only — `dependencies` stays absent)

Licence first, then version (`csharp.nuget-packages` § Licence before version, any ecosystem); each version at
least ~2 weeks old on 2026-10-12 and pinned EXACTLY (the coordinator's instruction for this story):

| Package | Version | Published | Licence |
|---|---|---|---|
| `storybook` | 10.6.0 | 2026-09-02 | MIT |
| `@storybook/html-vite` | 10.6.0 | 2026-09-02 | MIT |
| `@storybook/addon-a11y` | 10.6.0 | 2026-09-02 | MIT |
| `vite` (peer of html-vite `^5 \|\| ^6 \|\| ^7 \|\| ^8`) | 8.3.1, unless `npm audit` names an advisory that only a newer patch fixes (four vite lines were patched on one day, 2026-10-06) — then that patch, recorded with the advisory | 2026-09-24 | MIT |
| `axe-core` | 4.13.0 | 2026-08-05 | MPL-2.0 (file-level copyleft; a dev tool here, never bundled or shipped) |
| `jsdom` | 30.1.1 | 2026-09-22 | MIT (engines: node `^22.22.2 \|\| ^24.15.0 \|\| >=26`; CI runs Node 22) |

10.6.1 (2026-09-29), axe-core 4.14.0 (2026-10-05) and jsdom 30.1.2 (2026-10-04) are newer but under two weeks
old. No `@types/jsdom`: it pulls the DOM lib into the whole program, which `tsconfig.json:11` keeps out; the test
declares the three jsdom members it uses.

## 5. Tests — RED first, then green, then break-its

### 5.1 The gallery and the fakes

- `src/test/gallery/` (cases, §4.9) — test code, never shipped.
- `src/test/fakeDom.ts` — the STRICT fake document: `createElement` only for `KitTag`; `setAttribute` only for
  §4.3's attributes; every element a proxy that throws on any member it does not model (`innerHTML`, `style`,
  `outerHTML`, …); `textContent` takes strings only; events bubble element → ancestors; `focus()` tracked as the
  document's active element; `appendChild` moves an attached child. Its own contract tests,
  `src/test/fakeDom.test.ts` (`common.generated-code-tests` §3: a fake is code under test, stricter than the real
  thing and never more permissive).
- **Every behaviour test runs twice — on the strict fake and on jsdom** — so a behaviour that only the fake
  allows, or only the fake refuses, is visible as a difference rather than hidden by one of them.

### 5.2 RED list (each written first and watched failing for the real reason)

Tabs (`src/test/tabs.test.ts`):
1. the tablist / tab / tabpanel roles, `aria-controls` ↔ panel `id`, `aria-labelledby` ↔ tab `id`, exactly one
   `aria-selected="true"`, its panel the only one not hidden;
2. roving tabindex: `0` on the selected tab only;
3. ArrowRight from the last wraps to the first, ArrowLeft from the first to the last, Home / End, each focusing
   the new tab and calling `preventDefault`; a letter key changes nothing;
4. a click selects and calls `onSelect(id)` once; `select(id)` from code does not call it;
5. every tone shows its glyph AND its word; `setStatus` replaces and removes a mark live;
6. the refusals of §4.5, each naming what.

DataTable (`src/test/dataTable.test.ts`):
7. headers: a sortable column is `th[scope=col][aria-sort=none]` holding a `button[type=button]`; a non-sortable
   one has neither;
8. click → ascending, again → descending; `aria-sort` follows and is `none` on every other sortable column;
9. numbers sort numerically (`9` before `10`), `null` last in BOTH directions and shown as `—`, ties keep the
   original order; mixed numbers and strings: numbers first;
10. `format` shapes the cell (`14680064` → the consumer's `14.0 MiB`) and is never called with `null`;
11. search: case-insensitive over the SHOWN text, the status line counts, no hit shows `emptyText` once;
12. reveal: before any reveal no row's DOM text holds the hidden value (a fixture row carries it in a field no
    column reads); a click calls `onReveal` with exactly one argument, the index in the given `rows` — also after a
    descending sort and a search moved the row; `reveal(index, text)` fills only that row; `setRows` drops it;
13. the refusals of §4.6.

RecommendationCard (`src/test/recommendationCard.test.ts`):
14. glyph `aria-hidden`, word, sentence, the consumer's button placed as given, evidence as a list;
15. an action that is not a `BUTTON`, an unknown tone, an empty word, sentence or evidence entry are refused.

The surface, the stylesheet, the package (`src/test/componentsCss.test.ts`, `contrast.test.ts`, `axe.test.ts`,
`stories.test.ts`, and widened `architecture.test.ts`, `exports.test.ts`, `packaging.test.ts`):
16. every class any gallery case renders has a rule in `components.css` (derived from the rendered DOM, not
    listed), and the companion: the scan finds a known class;
17. `components.css` has no `url(`, `@import`, `!important` or `expression`, and every `--kit-*` token resolves
    to a `var(--vscode-…)`;
18. contrast (§5.4) for every theme fixture;
19. axe: zero violations over every gallery case; the companion broken case IS reported;
20. the CSF exports equal the gallery cases, both ways; the extractor's companion finds a known story;
21. the components entry's import closure reaches no host module and nothing outside `src/components/`; the root
    entry's still reaches `nonce.ts` (the known instance);
22. the components entry exports exactly its pinned list; the root list is unchanged;
23. the tarball carries `dist/components/index.js`, `index.d.ts`, `components.css`; no `stories/`, `.storybook/`,
    `gallery` or `storybook-static` path; `exports` names both subpaths; `sideEffects` admits `*.css`.

The consumer fixture (`test/consumer-fixture/`, run by `pack-and-consume`, §6):
24. a webview entry `src/webview.ts` importing `…/components` and `…/components.css` type-checks against the
    INSTALLED `.d.ts` with `lib: DOM` (a real `document` passed, no cast) and bundles for `platform: 'browser'`,
    `format: 'iife'`; the CSS output exists and carries the token block. (Written first as "and with `sideEffects: false`
    restored it does not"; refuted by the break-it, §11: esbuild 0.28.2 emits the CSS either way, webpack and Rollup honour the
    field. The guard for `sideEffects` is item 23's manifest assertion in `packaging.test.ts`, not this step; this step's own
    teeth are a fixture entry without the CSS import, which fails at `bundle`.)

Fit, never scroll (§4.6a — `src/test/dataTable.test.ts`, `componentsCss.test.ts`, `scripts/layout-check.mjs`):
25. every body cell's `data-kit-label` equals its column's header, after `setRows`, a sort and a search; the empty row
    has none; `stack` defaults to `medium`, each value adds its class, an unknown value is refused naming the four;
26. `components.css` declares `.kit-table` a size container, has a `@container` rule per stack width, draws
    `attr(data-kit-label)`, and gives no table, wrapper or cell an `overflow-x` of `auto` / `scroll` and no
    `min-width` in a length unit;
27. the layout check is green over every gallery case × 300 / 1280 / 1920 px × four themes × three sizes, plus the
    narrow box — and the gallery gains the cases that would break it: eight columns in an `18em` box, an unbreakable
    word (a long path) in a cell, a long header;
28. the layout check's companion: a planted `min-width: 40em` on `.kit-table__grid` and a planted `white-space: nowrap`
    on every cell each turn it RED with the offending case named (run from a temporary copy of the stylesheet; the
    real file is never edited, and its SHA-256 is compared after).

### 5.3 Break-its after green (each restored and checked by SHA-256)

The guarding test must go red, with the real symptom, for each of: a tab whose `aria-selected` is not updated;
the roving tabindex left at `0` everywhere; ArrowLeft not wrapping; `null` sorted first when descending; the
reveal callback handed the DISPLAY position instead of the row index; the revealed text written into every row;
`setRows` keeping revealed texts; a component class with no CSS rule; the ok tone mapped to
`testing-iconPassed` (Light Modern `#73C991` on white); the warning tone without its `editorWarning-foreground`
fallback (high contrast has no `list-warningForeground`); the components entry importing `../webview/nonce`;
`sideEffects: false` (caught by `packaging.test.ts`' manifest assertion — not by the esbuild step, §11); a CSF story removed. Never a tripwire disabled or weakened to make a break-it work.

### 5.4 Contrast (`src/test/contrast.test.ts`)

`.storybook/vscode-themes.css` carries, per theme (Dark Modern, Light Modern, Dark High Contrast, Light High
Contrast), the `--vscode-*` values the tokens read — resolved from `microsoft/vscode` @
`ac0e053d86439bc74274c21f68a88f78e4956271` (`extensions/theme-defaults/themes/*.json` along their `include`
chains, then the colour registry's defaults for the theme type, as `colorThemeData.ts:152-170` resolves them),
each line citing its source, and a variable VS Code leaves UNSET (`themeing.ts:64-68` skips an undefined colour)
absent from the fixture, so a `var()` fallback is exercised exactly where a real webview would need it. Values
VS Code emits with alpha are kept as the `rgba()` it emits and composited over the editor background in the test,
as a browser paints them. The test parses the token block out of `components.css`, resolves every token per
theme through its `var()` fallbacks, derives the pairs by the naming convention of §4.8, and computes the WCAG
2.x ratio: text ≥ 4.5, non-text ≥ 3. A token that resolves to nothing in some theme is a failure, never a skip.
What it proves is the mapping under THESE values; a user's own theme is theirs (§8).

### 5.5 The gate's plan round (session `a184ab9f`, 2026-10-12)

One reviewer (codex) of one answered; verdict `proceed`, gating count 1 of threshold 6.

| # | Finding | Decision |
|---|---|---|
| 0 | §4.8 does not say how the emitted stylesheet is authorised by the webview's nonce-only CSP | **Accepted in part.** §4.2 names the loading path (a `<link nonce>`, as wsl_care's shell already does) and §5.2 item 17 holds that the stylesheet needs nothing beyond the nonce; that a browser honours it is listed in §8 — the fixture runs under node and cannot observe a CSP. |

## 6. Build order

1. **This plan** (commit 1), `todo/README.md`'s row, and the boundary written into
   [PLAN_extract_the_kit.md](PLAN_extract_the_kit.md) (§2's table and the release decision, §7).
2. The gate's plan round (`review_plan`) until `proceed`.
3. Dependencies (`npm install --save-dev --save-exact`), `npm audit`, licences recorded (§4.11).
4. `src/components/dom.ts` + `src/test/fakeDom.ts` + its contract tests (RED → green).
5. `status.ts`, then `tabs.ts`, `dataTable.ts` (+ a pure `tableOrder.ts` for sort and filter),
   `recommendationCard.ts` — each with its RED list first; jsdom twin of every behaviour test.
6. `components.css` + `componentsCss.test.ts`; `src/components/index.ts`; `exports` / `sideEffects` /
   `scripts/copy-css.mjs`; architecture, exports and packaging tests.
7. The gallery, `.storybook/`, `stories/*.stories.ts`, `stories.test.ts`; `axe.test.ts`; theme fixtures and
   `contrast.test.ts`; `npm run build-storybook` green.
8. The consumer fixture's webview entry and `pack-and-consume`'s browser bundle + CSS check.
8a. §4.6a (added 2026-10-15, after the owner's review of the mockup): RED items 25–28 first, then `stack`,
    `data-kit-label`, the container rules, `scripts/layout-check.mjs` and its CI step.
9. CI: a `storybook` job (ubuntu-latest: `npm ci`, `npm run build-storybook`); `tsconfig.storybook.json`
   type-checked by `npm run typecheck`; eslint ignores `storybook-static/`.
10. Docs: `research/architecture.md` (module map, a components section with a Mermaid diagram, the package
    surface), `research/module_tests.md` (the flows, the fakes, what is not proven), README (consumer usage).
11. Break-its (§5.3), full suites and family checks, commit, the gate's code round, the PR, CodeRabbit,
    squash-merge (its commit body carries `Release-As: 0.2.0`, §7), and this plan promoted to `research/` in the
    same pull request once the code round has passed.

## 7. Release: how K1 becomes 0.2.0 — decided (rewritten 2026-10-18)

**What changed since 2026-10-12.** The first draft of this section assumed 0.1.0 would never be released by the time
K1 merged, and so had K1's squash commit carry `Release-As: 0.2.0` to make 0.2.0 the first published version. History,
kept because it explains the footer: on 2026-10-12 npmjs answered 404 for the package, `.release-please-manifest.json`
was `{}` with `initial-version: 0.1.0`, and the owner's one-time npm setup (an `npm` environment holding `NPM_TOKEN`) was
not done. That route is gone: 0.1.0 was tagged and its publish to npmjs failed (E403), so **0.1.0 never reached any
registry**; the package now goes to **GitHub Packages** (`publishConfig.registry`, the job's own `GITHUB_TOKEN`, an
artifact attestation — [research/PLAN_publish_to_github_packages.md](../research/PLAN_publish_to_github_packages.md)) and
**0.1.1 was published there on 2026-10-17**. There is no npm token and no npmjs setup in the order any more.

As of 2026-10-18: `.release-please-manifest.json` is `{".":"0.1.1"}` and `package.json` says `0.1.1`, so release-please
has a latest release to count from.

- **K1 is a plain `feat:`.** On top of 0.1.1, release-please proposes 0.2.0 by itself: a `feat` bumps the minor, and
  neither `bump-minor-pre-major` nor `bump-patch-for-minor-pre-major` is set in `release-please-config.json` (so its
  defaults apply — a `feat` before 1.0 is a minor). The epic wants wsl_care to pin 0.2.0 = the 0.1.x modules + K1.
- **The squash commit still carries `Release-As: 0.2.0`** — the coordinator's explicit decision, so that 0.2.0 does
  not depend on how release-please counts a pre-1.0 `feat`. It is harmless when the default already says 0.2.0.
  Checked, not recalled (release-please 17.11.2 on npm, the same reading as the first draft):
  `build/src/strategies/base.js:325-340` — `buildNewVersion` takes a commit's `RELEASE AS` note BEFORE the versioning
  strategy; `build/src/commit.js:221-231` turns the `Release-As:` footer into that note. The action's own bundle
  (v5.0.0) was not re-read for this.
- `src/test/releaseConfig.test.ts` stays green either way: until release-please's pull request, the manifest and
  `package.json` both say 0.1.1; from that pull request on both say 0.2.0 and `CHANGELOG.md` carries its section.
- A consumer installs 0.2.0 from GitHub Packages (README "Use": the scope's `.npmrc` and a `read:packages` token) — not
  from npmjs. `pack-and-consume --published 0.2.0` is the post-deploy proof, run after the release; run against 0.1.1
  it fails by design, because the checked-out manifest names `./components` and 0.1.1's tarball does not carry it.
- Nothing here runs a release, publishes, creates a tag or touches a secret.
## 8. What this does NOT prove (carried into `research/module_tests.md`)

- That a browser turns Enter / Space on a `<button>` into a click: the platform's contract, used in the
  Storybook by hand, not run in CI.
- Colour contrast in a real rendering: jsdom has no layout; the contrast check covers the token mapping under
  representative theme values, and a user's own theme can still choose poor colours.
- That wsl_care's harness accepts the surface: its W0 widens it per §4.3, with its own RED tests.
- That a webview loads the emitted stylesheet under its nonce-only CSP: the consumer's shell and a real browser;
  the kit proves only that the stylesheet needs nothing beyond the nonce (§4.2).
- Screen-reader output: axe checks roles, names and ARIA validity, not what a reader announces.

## 9. Growth surfaces

None persistent. A `DataTable` holds the rows it was given and, at most, one revealed text per row, dropped on
`setRows`; a `Tabs` holds its tabs. `storybook-static/` is a build output, git-ignored and rebuilt from scratch by
`storybook build`. CI gains one job (the Storybook build) on ubuntu.

## 10. Definition of Done

- [ ] The three components, the status tones and the stylesheet exist with the API of §4; nothing in them uses
      `innerHTML`, `style` or an inline handler; no domain word.
- [ ] `./components` and `./components.css` resolve from the PACKED tarball: the consumer fixture's webview entry
      type-checks with a real `document` and bundles for the browser with its CSS.
- [ ] Every RED test of §5.2 was seen failing for the real reason, then green; every break-it of §5.3 turned the
      right test red; the whole suite green on both CI legs.
- [ ] Storybook builds; every component × state × theme × size is in it; axe zero violations over every gallery
      case in CI; contrast checked.
- [ ] No table scrolls sideways (§4.6a): the layout check is green in CI over every case × width × theme × size,
      and its companion turns red on a planted `min-width`.
- [ ] `dependencies` absent; `npm pack --dry-run` lists `dist/` and the bin only; no Storybook file ships.
- [ ] `research/architecture.md`, `research/module_tests.md` and README describe what shipped.
- [ ] The release decision of §7 applied at the merge and recorded in both kit plans.
- [ ] The gate's plan and code rounds reached `proceed`; CodeRabbit's threads answered and resolved; merged.
- [ ] This plan promoted to `research/` with `IMPLEMENTED <date>` and its deviations.

## 11. As built (recorded 2026-10-15, on `feat/kit-k1-components`; the sideEffects note of §3 and the §4.6a build)

**§3, `sideEffects`.** The premise that a bundler drops a bare CSS import under `sideEffects: false` was refuted for
esbuild 0.28.2 by the break-it: with `false` restored, `pack-and-consume`'s browser bundle still emitted the CSS. The
manifest says `["*.css"]` anyway, because webpack and Rollup honour the field for CSS; the guard is
`packaging.test.ts` (the manifest test), not the esbuild step.

**§4.6a, built RED-first.** Items 25–28 are in `dataTable.test.ts` (both documents), `componentsCss.test.ts`,
`layoutCheck.test.ts` and `scripts/layout-check.mjs`. Deviations and decisions the plan did not spell out:

- `kit-table--stack-<value>` is on the `table` element (`kit-table__grid`), not on the `.kit-table` root: a container
  query styles the container's descendants only, never the container itself.
- Four gallery cases `stack-narrow|medium|wide|never` stand for "a stacked case per width"; `eight-columns` is wrapped
  in the gallery's `gallery-narrow` (18em) box by the case itself; `unbreakable-cell` and `long-header` are plain
  tables. The check additionally renders EVERY DOM case inside the same box (`gallery-narrow`, `max-width: 100%` so a
  narrow page is not widened by the harness) — 26 cases x 2 renders x 36 states = 1872 case-states.
- The layout page is `.storybook/layout-page.ts`, bundled for the browser by esbuild (already a devDependency, so no
  new one) and type-checked by `tsconfig.storybook.json`; it carries the probe (page scroll, element past the edge,
  `scrollWidth > clientWidth`, table wider than its parent). The page also takes `.storybook/gallery.css` (the three text
  sizes and the box are classes there) beside `components.css` and `vscode-themes.css`.
- Item 28's companion is a script mode, `npm run layout-check -- --companion` (CI's `storybook` job runs it), not a unit
  test, because it needs Chrome; `layoutCheck.test.ts` holds what does not: the gallery's breaking cases, CI's steps,
  and exit 3 for a `CHROME_PATH` naming nothing (and, on Linux, an empty PATH). `CHROME_PATH` naming nothing is an error,
  never a fallback to another browser; Windows cannot hide its install paths from a child process, which is why the
  test is shaped this way.
- `components.css`: one `@container kit-table` block per width (30 / 40 / 60em); the 30em block also releases the
  end cells' `nowrap`. A header with no sort button is hidden when stacked with `:not(:has(.kit-table__sort))`
  (Chromium 105+, which VS Code's webview is). `stack: 'never'` has no block; its class carries `table-layout: auto`
  so every class a case renders has a rule (`componentsCss.test.ts`).
- Public surface: the type `StackWidth` is exported (nineteen types); `STACK_WIDTHS` is internal.

**What the break-its found.** One real tripwire gap, fixed RED-first: `architecture.test.ts`' closure walk matched only
`import ... from '...'` and `export ... from '...'`, so `import '../webview/nonce';` in the components entry passed. The
walk now reads the side-effect shape (a fixture pins every shape, type-only ones skipped); the break-it then goes RED.
One scan of mine was weak and its own fixture caught it (`min-width: 100%` slipped past a unit pattern). In the
browser, with the real stylesheet broken: cells no longer breaking a word turned the check RED for
`dataTable/unbreakable-cell`; the table no longer a size container turned 25 case renders RED (the same symptom as the
stylesheet before 4.6a: `the page scrolls sideways: 363px of 300px`).

**Found on the rebased branch, 2026-10-18.**

- **The layout check exited 1 after a GREEN run on a loaded Windows machine.** The browser was ended and the profile
  folder removed, and the removal failed with `EPERM` while Chrome's helpers (the crash handler above all) were still
  ending — up to 40 s after the kill. `rmSync`'s `maxRetries` did not help: Node 24 threw after 3 ms with
  `maxRetries: 240` set (measured with a scratch script). `scripts/layout-check.mjs` now ends the browser at once (a
  throwaway profile has nothing to close politely: `taskkill /T` of its own PID on Windows, the handle's `kill()`
  elsewhere) and removes the folder in its own bounded retry loop of up to two minutes (`scripts/lib/cleanup.mjs`). A folder that stays busy only prints a warning on stderr: the check's own result — its error or its pass — stands. `taskkill` has a 30 s ceiling. Seen RED on every run while the machine was loaded (exit 1, `FAILED -
  EPERM, Permission denied`), green after the fix (exit 0, no folder left) on the same machine. The retry and "a failed removal never replaces the run's result" are unit-tested with a fake removal in layoutCheck.test.ts (red first against a removal that propagated: the run's error was replaced by `EPERM busy`, and a passing run threw); the Windows timing itself needs Chrome and a loaded machine, so it is not; `layoutCheck.test.ts`'s `CHROME_PATH` tests (item 27's no-browser exit) pass.
- **A Chrome that never opened its DevTools port was never ended** (the gate's cadence consultation, verified): `launch` spawned it, `endpointOf` threw, the caller never got `started` and so `shutDown` could not reach the child - an orphan holding the profile. `startOrEnd` (`scripts/lib/cleanup.mjs`) now ends the child by its own handle, awaits its exit (bounded, 10 s) and rethrows the original error. Red first with a fake child that never writes the port file (`actual: [], expected: [ 'fake-chrome' ]`: nothing was ended), green after; the break-it - the kill-on-failure removed - is red with the same line, restored byte-identical.
- **A port file Chrome still held open ended a run.** On a loaded machine a green-so-far run died with `EBUSY: resource busy or locked, open '...DevToolsActivePort'`: `endpointOf` read the file while Chrome was writing it and let the lock error out. A locked or unreadable port file is now "not yet" (the next poll reads it; the wait stays bounded by `WAIT_MS`). Red first with an injected reader that throws `EBUSY` twice (`Error: EBUSY: resource busy or locked` out of `endpointOf`), green after. The same run showed the new kill-on-failure working: the failed start left no folder behind.
- **Break-it of the `CHROME_PATH` test:** `findChrome` made to fall back when `CHROME_PATH` names nothing turns the test
  RED with the real symptom (`actual: 0, expected: 3` — another browser ran the whole check and passed); restored
  byte-identical.
- **After the rebase** (the files it touched, each restored byte-identical): `sideEffects: false` and the `./components.css`
  export removed each turn `packaging.test.ts`' manifest test RED; the consumer fixture without its `components.css`
  import fails `pack-and-consume` at `bundle` (*the webview bundle emitted no dist/webview.css*); `REQUIRED` back to the two
  root files fails it at `contents` (*dist/ in the tarball holds more than .js, .d.ts and the files exports names:
  dist/components/components.css*).
**Code round, 2026-10-18 (coai a184ab9f) — the twelve accepted fixes, as built.**

1. `runThenRemove`: a throwing `stop()` is reported, never replaces the run's error; the removal still runs.
2. `startOrEnd`: a throwing `end()` or `waitForExit()` is reported through `warn` and the ORIGINAL error is rethrown.
3. A spawn error (ENOENT) is no longer swallowed: `endpointOf` rejects at the next poll as `could not start Chrome: <message>`, and `startOrEnd` ends and cleans (`spawnBrowser` records it).
4. The port file is validated before a URL is built (port 1-65535 digits only; path under `/devtools/`, no `?`, `#` or whitespace); anything else is "not yet" and is named in the timeout error.
5. The DevTools socket has ceilings (`withTimeout`: 30 s to open, 60 s per command); on a timeout the socket is closed so the clean-up runs.
6. One progress line per checked state (`layout-check: 300px dark small - fits`); the final verdict lines are unchanged.
7. `copy-css.mjs`: the two failures have distinct messages (pinned by `copyCss.test.ts`).
8. `copy-css.mjs` refuses a source outside `<root>/src` and a destination outside `<root>/dist` (a `..` in an `exports` target) with its own message.
9. `filter(query)`: a non-string is a `TypeError` naming the type; the search box still passes its string.
10. The ordered rows are computed once per repaint (`paint` passes its order on; `visible` is gone).
11. A revealed text is searchable; `setRows` drops it.
12. `reveal(index, text) → boolean`: a click records a PENDING request in the current rows; `reveal` applies only to a pending index and clears it, otherwise it answers `false` and changes nothing (no throw); `setRows` clears pending. A late reply can no longer land on a new row. The gallery's `revealed` case now presses the button through a spy document (`src/test/gallery/spy.ts`), because a reply without a press is refused.
**The gate's code round (session `a184ab9f`, 2026-10-18).** Verdict `proceed`, gating 12 of threshold 5; **12 of 16
reviewers answered** (all four kimi roles failed). The cadence consultation it required (2b97fd01) closed `solved`.
Accepted and built (the twelve items above): `stop()` and `end()`/`waitForExit()` never replace the original error; a spawn
error fails the endpoint wait at once; the DevTools port file is validated; the DevTools waits have ceilings; progress
lines; copy-css's distinct messages and containment; `filter` refuses a non-string; one ordering pass per repaint; a
revealed text is searchable; a late reveal can no longer land on a new row. Rejected with reasons: tone/CSS drift (the
derived class-rule scan over every tone already fails the build), the DOM-port whitelist (the design, §4.3), a constants
file for the English defaults (all overridable), a search debounce and virtualization (the consumers' tables are small;
§4.6a lays every row out), immutability of the component's internal state (it never escapes), a POST_DEPLOY item for the
components (item 5's `pack-and-consume --published` already imports both subpaths from the published tarball), and a
concrete version in POST_DEPLOY's instruction (the stamp stays concrete).

**Code round 2 (good_enough), 2026-10-18 — two accepted changes, as built.**

13. A reveal reply carries a REQUEST TOKEN: `onReveal(index, request)` hands the consumer an opaque id (`<generation>:<n>`, unique per click for the life of the table, no row data) and `reveal(index, text, request) → boolean` applies only for the row's CURRENT pending request, then spends it. A missing, unknown, older, spent, or pre-`setRows` request answers `false`; this closes the hole where, with a Set of indexes, the FIRST reply was accepted after the SAME row was clicked again. A request that is not a string is a `TypeError`; the existing refusals still come first.
14. The pressed button says it waits: its text becomes `Waiting…` (`reveal.waitingText` overrides it), it gains `kit-table__reveal--pending` (a muted rule in `components.css`), and a click on a waiting button does nothing, so `onReveal` is told once. The revealed text replaces it; `setRows` resets it. The gallery's `revealed` case now shows one revealed row and one waiting row.

**Security round, 2026-10-19 (Fable: do not ship on ea7b1ec) — as built.**

- **D1.** A late reply after `setRows` shrank the rows threw `there is no row N`, against the contract. `reveal` now keeps only programmer-error `TypeError`s (no reveal column, an index that is not a whole number of 0 or more, a non-string text or request); a missing row or a request that is not current answers `false`. Red first on both documents; break-it: the old check order.
- **H1.** `setRows` is all or nothing: the new views are built first, then rows, views, generation and pending are swapped and the tbody cleared; a throwing `value()`/`format()` leaves the table exactly as it was (revealed secrets and pending requests included). A `countText` that throws still throws after the swap (it runs in the repaint). Break-it: the old order.
- **H2.** `dispose()` on the view: pending requests dropped, `reveal` answers `false`, a reveal click tells nobody, `setRows`/`sortBy`/`filter` are no-ops (my choice, so a late poll after the panel closed cannot touch the table), safe twice. Wrong arguments are still `TypeError`s. `dispose` is a method of the returned view, so `exports.test.ts` needed no change.
- **H3 (doc).** README and the d.ts: the only reset of a waiting row is `setRows` (or `dispose`); a host that cannot answer answers `reveal(index, 'not available', request)`; no `cancel()`.
- **H4 (doc).** The `button(row)` text is in the page before any reveal: never the hidden value (d.ts and README).
