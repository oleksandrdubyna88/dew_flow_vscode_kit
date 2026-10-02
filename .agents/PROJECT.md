---
requires: ["README.md","research/architecture.md"]
---
# Project instructions — dew_flow_vscode_kit

Shared family rules are mounted at `.agents/conventions` (the `dew_flow_conventions` submodule,
tracking its `release` branch) and apply here exactly as local rules would. Fresh clone:
`git submodule update --init .agents/conventions` and
`npm ci --ignore-scripts --prefix .agents/conventions`.

## What this repository is

**`@oleksandrdubyna88/vscode-webview-kit`** — the webview building blocks the family's VS Code
extensions share instead of copying: a help page with five languages, a visible fallback and
stale-translation detection; the ± text size and ± text tone controls with their host halves; the
"a view setting could not be saved" reporter; and the HTML/JSON escapers a webview page needs. It was
extracted from ConnectOtherAIs (`dew_flow_connect_other_ais/src_vs_code/src`) on 2026-10-02 so that
`wsl_care` would not start life with a second copy.

Consumers bundle it with esbuild into their own `dist/extension.js`; nothing from this package ships
as a separate runtime dependency in a `.vsix`.

## Commands

```bash
npm ci
npm run typecheck      # tsc --noEmit over src and test
npm run lint
npm test               # compile, then node --test over every *.test.js the build produced
npm run build          # dist/ for publishing: CommonJS + .d.ts
npm pack --dry-run     # what a publish would contain
```

## Non-negotiables

- **Pure modules never import `vscode` or `node:`-only APIs a webview cannot run** — page modules are
  plain functions from values to strings, so what they render is a unit test. The few HOST modules
  take a narrow port (configuration read/update/change, webview postMessage) rather than the
  `vscode` namespace, so they are tested with a fake that is stricter than the real API, never more
  permissive.
- **Behaviour is byte-compatible with what ConnectOtherAIs shipped** for the same inputs — the
  consumer passes its own configuration section, product name and CSS variable prefix, and gets
  exactly the markup it rendered before the extraction. A test pins that against coai's own
  values.
- **A webview page script is tested by RUNNING it** (the family rule `common.generated-code-tests`):
  substring assertions over page source are not accepted for behaviour.
- **User-facing text is English**, except help article BODIES and the help page's own chrome, which
  exist in the catalog's languages.
- **No runtime dependencies.** A consumer bundles this; a dependency here is a dependency in every
  extension.
