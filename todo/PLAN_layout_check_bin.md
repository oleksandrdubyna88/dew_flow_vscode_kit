# PLAN — K2: the layout check ships as a bin, so a consumer checks its OWN page

> Status: **plan only (2026-10-22)** — story **E18.K2** of wsl_care's epic E18 (`wsl_care · todo/PLAN_disk_health.md` §3.6 and
> `todo/PLAN_disk_health_E18.md` § W1b): the E18 plan says the layout check of K1 §4.6a "ships from the kit as a bin, else a small
> kit story before W1b". 0.2.0 does not ship it (`package.json` `files` and `bin` name only the help digests), so this is that story.
> Release: **0.3.0** (a `feat:`) through the kit's own release-please + split publish pipeline, approved under the same plan as
> 0.1.1 and 0.2.0 (the coordinator, 2026-10-22).
>
> Related: [PLAN_kit_components_storybook.md](../research/PLAN_kit_components_storybook.md) §4.6a (the check as built for the
> gallery), [architecture.md](../research/architecture.md), [module_tests.md](../research/module_tests.md).

## 1. Goal

wsl_care's full view (E18.W1b) must prove the owner's two layout rules in a REAL browser — no table, box or page scrolls
sideways, and cards side by side in one row have one height — over its OWN page, at 300 / 1280 / 1920 px, in the four VS Code
themes and three text sizes. The kit already has that machine (`scripts/layout-check.mjs`, 346 lines, plus the probe in
`.storybook/layout-page.ts`), but only for its gallery and only inside its repository. Copying it into wsl_care is refused
(`common.reuse-first`). So:

1. The package ships a bin **`vscode-webview-kit-layout-check`** that checks a consumer's static page FILE(S):
   `vscode-webview-kit-layout-check --page <file.html> [--page …] [--rows <css selector>] [--single-line <css selector>]
   [--widths 300,1280,1920] [--themes dark,light,high-contrast,high-contrast-light] [--sizes small,default,large] [--json <out>]`.
   Exit codes as today: 0 pass · 1 a layout defect (each named: page, width, theme, size, what) · 2 usage · 3 no browser.
2. The checks are the existing probe's (the page wider than the window; an element past the window's edge; a box whose content
   is wider than the box; a table wider than its parent) PLUS two new ones the consumer opts into:
   - **`--rows <selector>`**: the elements matching it that share a row (the same rounded top) must have one height (± 1 px);
   - **`--single-line <selector>`**: each matching element's text must lie on ONE line (its client rects share one top) —
     wsl_care's "PIDs never wrap".
3. The themes and sizes are applied the way the gallery check does: the theme class on `<body>` from the shipped
   `vscode-themes.css` (the resolved `--vscode-*` values, K1 §5.4) and a font-size class; the consumer's page links its own
   stylesheets; the bin injects only the theme sheet and the probe.
4. **The browser is boxed in.** The page is loaded from a `file:` URL the consumer named (resolved and required to exist; a
   directory or a non-`.html` file is a usage error); Chrome runs headless with a fresh profile under `testsToDelete-…`
   removed in a `finally`; EVERY request that is not a `file:` URL under the page's own folder (or `data:`/`about:`) is failed
   through the DevTools `Fetch` domain (no network, no other file) and counted as a defect ("the page asked for <url>"). Only
   the process the bin started is ever killed, by its handle — never by image name.
5. The kit's own gallery check becomes ONE consumer of the same code (`npm run layout-check` builds the gallery page and runs
   the bin's core over it), so there is one implementation.
6. The tarball carries the bin, the probe (built for the browser), and `vscode-themes.css`; still ZERO runtime dependencies
   (the bin uses Node's own `WebSocket`, no esbuild at run time — the probe ships pre-built).

## 2. Where things are today (kit `main` @ `1d2681c`)

- `scripts/layout-check.mjs` (346 lines): finds Chrome (`CHROME_PATH`, the usual paths, Edge on Windows), builds the gallery page
  with esbuild from `.storybook/layout-page.ts` (113 lines: renders every gallery case in the page and in an `18em` box, and the
  probe), drives it over the DevTools protocol (`Emulation.setDeviceMetricsOverride` for the viewport), WIDTHS / THEMES / SIZES,
  `--companion` (planted `min-width` / `nowrap` stylesheets must turn it RED), exit codes 0/1/2/3, profile `testsToDelete-layout-check/`.
  Helpers in `scripts/lib/cleanup.mjs` (`spawnBrowser`, `endpointOf`, `removeWithRetry`, `runThenRemove`, …).
- `package.json`: `files: ["dist", "scripts/help-digests.mjs"]`, `bin: { "vscode-webview-kit-help-digests": … }`,
  `"layout-check": "node scripts/layout-check.mjs"`; `src/test/packaging.test.ts` pins what the tarball carries;
  `src/test/layoutCheck.test.ts` exists.
- `.storybook/vscode-themes.css`: the resolved theme values (K1 §5.4).

## 3. Design

- **Split the script into a shipped core and two callers.** `scripts/layout/` (shipped): `check.mjs` (the bin: argument parsing,
  page list, the matrix, the report, exit codes), `browser.mjs` (find / start / boxed Chrome / CDP session — moved from the
  current script and `lib/cleanup.mjs`'s browser half), `probe.js` (the probe, built at `npm run build` from a TypeScript source
  `src/layout/probe.ts` into `dist/layout/probe.js`, injected with `Page.addScriptToEvaluateOnNewDocument` or after load),
  `dist/layout/vscode-themes.css` (copied at build from `.storybook/vscode-themes.css`, one source). The kit's
  `scripts/layout-check.mjs` stays as the GALLERY caller: it builds the gallery page into a temp folder and calls the core.
- **The probe** keeps today's four checks and adds `rows` and `singleLine` (§1.2), each a pure function over the DOM it reads,
  reporting `{ where, problem }` with the element's tag, class list and text (cut to 40 chars) — never the page's data beyond that.
- **No network.** `Fetch.enable` with a pattern for every request; `file:` under the page's folder and `data:` continue; anything
  else `Fetch.failRequest` + a defect. `--allow-file-access-from-files` is NOT passed. Chrome flags: `--headless=new
  --disable-gpu --no-first-run --no-default-browser-check --disable-extensions --disable-background-networking
  --user-data-dir=<testsToDelete-…>`.
- **Usage errors (exit 2)**: no `--page`; a page that does not exist, is not a file, or does not end in `.html`; an unknown option;
  a width outside 200–4000; an unknown theme or size; an empty selector.
- **Report**: one line per defect `FAIL <page> <width> <theme> <size> <where>: <problem>` and a summary; `--json <file>` writes the
  same as JSON (the consumer's CI may upload it).
- **Docs**: README "Check your own page's layout" (the command, the selectors, the exit codes, what it does not prove);
  `research/architecture.md` (the module map gains `scripts/layout/`), `research/module_tests.md`.

## 4. RED list (each watched failing for the real reason first)

1. A planted page with a table wider than its box (`min-width: 40em` at 300 px) → exit 1 naming the page, width and the table.
2. A planted page whose body is wider than the window → exit 1 "the page scrolls sideways".
3. `--rows '.card'` over a planted row of two cards of different heights → exit 1 naming both heights; the same page with equal
   heights → exit 0; cards on DIFFERENT rows with different heights → exit 0.
4. `--single-line '.pid'` over a planted cell that wraps at 300 px → exit 1; one that fits → exit 0.
5. A planted page that asks for `https://example.invalid/x.css` and for a `file:` outside its folder → exit 1 naming both
   requests, and no request left the machine (the `Fetch` log shows them failed).
6. Usage: each case of §3 "Usage errors" → exit 2 with its sentence; no browser started (`CHROME_PATH` pointing at a missing file
   → exit 3, never a pass).
7. The gallery check (`npm run layout-check`) still passes and its `--companion` still turns RED on both plants — through the
   shared core.
8. Packaging: the tarball carries `scripts/layout/*.mjs`, `dist/layout/probe.js`, `dist/layout/vscode-themes.css` and the new bin;
   `dependencies` still absent; `pack-and-consume` installs the packed tarball in the consumer fixture and RUNS the bin over a
   fixture page (pass) and a planted one (exit 1).

## 5. Break-its (each restored, SHA-256 compared)

The rows check always passing → RED 3. The single-line check reading `offsetHeight` only → RED 4 (a cell with one tall line).
`Fetch` not enabled → RED 5. The theme class not applied → a theme-specific planted defect (a rule only under `.vscode-light`)
passes → RED (add that plant to RED 1). Never a tripwire disabled.

## 6. Build order

1. This plan; the coai plan round. 2. RED 1–8 over planted fixture pages in `src/test/fixtures/layout/`. 3. Split the script; the
probe source; the build step; the bin; the gallery caller on the core. 4. Break-its; docs. 5. Full runs (typecheck, lint, test,
build, pack-and-consume, build-storybook, layout-check — one heavy run at a time, below-normal priority, ≤ 8 workers). 6. The code
round, the PR, CodeRabbit, the merge on every check green (the kit's `main` has no branch protection — by hand), then the
release-please PR for 0.3.0 and the release run watched end to end (artifact sha256, attestation, publish once, verify, consume).

## 7. What it does not prove

That a real VS Code webview lays a page out like headless Chrome does (the same engine family, not the same window); colour
contrast (K1 §5.4 covers the tokens); anything about a page's behaviour (the consumer's harness tests that).

## 8. Definition of Done

- [ ] The bin works over a consumer page file with `--rows` and `--single-line`; RED 1–8 seen red then green; break-its red.
- [ ] One implementation: the gallery check calls the same core; no copy anywhere.
- [ ] No network and no file outside the page's folder reaches the page; only the bin's own Chrome is ever stopped.
- [ ] Tarball and `pack-and-consume` prove the shipped bin runs; zero runtime dependencies.
- [ ] Docs; plan and code rounds resolved; merged on all green; 0.3.0 published and verified by the release run.
