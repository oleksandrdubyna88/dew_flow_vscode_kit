# Architecture — dew_flow_vscode_kit

> As of 2026-10-02 this repository holds **no product code yet**: the build is planned in
> [../todo/PLAN_extract_the_kit.md](../todo/PLAN_extract_the_kit.md). This file describes what exists
> and is rewritten as each module lands.

## What exists

- The family rules, mounted at `.agents/conventions` (tracking `release`), and the Claude host adapter
  (`.claude/settings.json`, `.claude/hooks/`).
- The plan.

## Consumers (cross-repository)

| Repository | Uses | Since |
|---|---|---|
| `dew_flow_connect_other_ais` | the source of the extracted modules; switches to the package in its own PR | planned |
| `wsl_care` | the help page and display controls of its extension | planned |
