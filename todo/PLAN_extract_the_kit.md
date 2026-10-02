# PLAN — extract the help / text-size / text-tone / setting-write modules into one shared package

> Status: **plan only, nothing implemented yet, 2026-10-02.** Scope: this repository's first release,
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
| — (new) | `src/help/digest.ts` | `digestOf(body)`: first 8 hex of SHA-256 of the five fields joined | — |

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

## 5. Growth surfaces

None at run time: the package keeps no files, no caches and no state beyond the in-memory write queue
(one promise chain per host).

## 6. Definition of Done

- [ ] 0.1.0 published from CI with provenance; `npm view @oleksandrdubyna88/vscode-webview-kit` shows it.
- [ ] Byte-compat tests green and shown to have teeth.
- [ ] Stale-translation detection implemented and tested.
- [ ] ConnectOtherAIs switched (merged PR), suite green; no copy of these modules left there.
- [ ] wsl_care's extension imports the package.
- [ ] `research/architecture.md`, `research/module_tests.md` describe what shipped; this plan promoted.
