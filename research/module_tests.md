# module_tests — the harness, the flows it drives, and what it does not prove

> Adopted 2026-10-02 with no product code yet; every flow is `not covered` until its module lands.

## Where the harness is and how it runs

`src/test/` beside the sources, compiled with them by `npm run compile` (tsc → `out/`; `tsconfig.build.json`
keeps it out of `dist/`) and run by `npm test`: `scripts/run-tests.mjs` reads `out/test/` and hands every
`*.test.js` to `node --test` — a readdir, no glob, no shell. CI runs the same command on `ubuntu-latest`
and `windows-latest`, after `git config --global core.autocrlf false`.

Two helpers every page test uses (E1.S1):

- `src/test/pageHarness.ts` — RUNS a page script in a `node:vm` context whose globals are an explicit
  allowlist (`document`, `window`, `acquireVsCodeApi`), under a 5 s deadline that also covers every click
  and message the test dispatches afterwards. Stricter than a browser: `querySelector` / `getElementById`
  answer `null` on a miss, a node the page was never handed cannot be clicked, `closest` refuses a selector
  shape it cannot read, and what the page posts must be structured-cloneable.
- `src/test/lineEndings.ts` — `assertNoCr(text, what)`, failing with the index of the first CR, so a
  rendered fragment cannot pass on one platform and fail on the other.

`src/test/architecture.test.ts` scans every pure module — everything under `src/` outside `src/test/` and
the host allowlist (`src/webview/nonce.ts`) — for `vscode` / `node:` imports and fails naming `file:line`;
a companion test proves the scan finds all four import shapes in a fixture, so it cannot pass vacuously.

## Flow catalogue

| Flow | Covered | By |
|---|---|---|
| A page script runs under the harness: a press posts through `acquireVsCodeApi`, a pushed message repaints, an undeclared global is a `ReferenceError`, an infinite loop fails by the deadline | covered | `src/test/harness.test.ts` |
| No pure module imports `vscode` or a `node:` API | covered | `src/test/architecture.test.ts` |
| A consumer renders the help page and navigates it | not covered | the help module is not built yet |
| A page's ± size / ± tone press posts one step, a pushed value repaints the page (zoom and tone scripts RUN) | covered | `src/test/displayScripts.test.ts` |
| For ConnectOtherAIs' config the display markup, scripts and CSS are byte-identical to coai `1056aed9` (values recorded from coai's own modules by `scripts/record-coai-display.mjs`) | covered | `src/test/displayByteCompat.test.ts` — shown to have teeth: a zoom step of 1.2 turns 9 of its tests red |
| A press reaches the SETTING and every open page (the host half) | not covered | `display/host` is epic 2 |
| A failed view-setting write is reported once, through the consumer's reporter | covered | `src/test/settingWritten.test.ts` |
| Setting writes run in order, two quick presses are two steps, a failure never stops the next write | covered | `src/test/writeQueue.test.ts` |
| Escaping: HTML text/attributes, a script body, a nonce safe in a CSP header | covered | `src/test/escape.test.ts` |

## What it does not prove

A real VS Code extension host is never started here; the consumers' own suites (and coai's editor
harness) are where a real webview is exercised.

## When it runs

On every pull request and push to `main`, in CI.
