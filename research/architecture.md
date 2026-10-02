# Architecture — dew_flow_vscode_kit

> As of 2026-10-02 this repository holds **no product code yet**: the build is planned in
> [../todo/PLAN_extract_the_kit.md](../todo/PLAN_extract_the_kit.md). This file describes what exists
> and is rewritten as each module lands.

## What exists

- The family rules, mounted at `.agents/conventions` (tracking `release`), and the Claude host adapter
  (`.claude/settings.json`, `.claude/hooks/`).
- The plan.
- **The package machinery (E1.S1):** `package.json` (`@oleksandrdubyna88/vscode-webview-kit` 0.1.0, CommonJS,
  `main`/`types`/`exports` into `dist/`, `files: ["dist"]`, no `dependencies`), `tsconfig.json` (coai's strict
  set, ES2022 without DOM, `noEmitOnError`) and `tsconfig.build.json` (declarations into `dist/`, tests
  excluded), `eslint.config.mjs` (type-aware, `complexity 4` / `max-lines-per-function 50` on `src/**`,
  `linebreak-style unix`), `scripts/run-tests.mjs` (readdir discovery, `node --test`), `scripts/clean.mjs`.
- **CI:** `.github/workflows/ci.yml` runs the whole chain — conventions check, plan lifecycle, typecheck,
  lint, test, build, `npm pack --dry-run` — on `ubuntu-latest` AND `windows-latest`, every action pinned to a
  commit SHA; `pr-title.yml`, `coderabbit-review.yml` + `.coderabbit.yaml`, `dependabot.yml`.
- **The test harness** — see [module_tests.md](module_tests.md).

## Consumers (cross-repository)

| Repository | Uses | Since |
|---|---|---|
| `dew_flow_connect_other_ais` | the source of the extracted modules; switches to the package in its own PR | planned |
| `wsl_care` | the help page and display controls of its extension | planned |
