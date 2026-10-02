# module_tests — the harness, the flows it drives, and what it does not prove

> Adopted 2026-10-02 with no product code yet; every flow is `not covered` until its module lands.

## Where the harness is and how it runs

`test/` beside `src/`, compiled with the sources and run by `npm test` (`node --test` over every
compiled `*.test.js`, discovered by readdir). CI runs the same command.

## Flow catalogue

| Flow | Covered | By |
|---|---|---|
| A consumer renders the help page and navigates it | not covered | the help module is not built yet |
| A page's ± size / ± tone press reaches the setting and every open page | not covered | the display module is not built yet |
| A failed view-setting write is reported once | not covered | the settings module is not built yet |

## What it does not prove

A real VS Code extension host is never started here; the consumers' own suites (and coai's editor
harness) are where a real webview is exercised.

## When it runs

On every pull request and push to `main`, in CI.
