# PLAN — every local test and build run in the kit is capped at 8 workers and runs at lowered priority

> Status: **plan only, nothing implemented yet, 2026-10-20.** Scope: `scripts/run-tests.mjs`, `package.json`
> scripts (`test`, `build-storybook`, `storybook`, `layout-check`, `pack-and-consume`), a new
> `scripts/lower-priority.mjs` (the conventions' preload template), the tests that pin them, README and
> `research/module_tests.md`. Filed after K1 (its code rounds 2–4 raised it and it was deferred so every entry
> point changes together); see [PLAN_kit_components_storybook.md](../research/PLAN_kit_components_storybook.md) §11.

## 1. Symptom and goal

The family rule `common.local-cpu-budget` (MANDATORY since 2026-10-10) says every LOCAL test or build run sets
its worker count at 8 or fewer (`min(8, os.availableParallelism() - 1)`, never a bare 8 CI also reads) and runs
below interactive work (BelowNormal on Windows, nice 19 elsewhere), and that CI is exempt and is never raised.
This repository has adopted none of it (checked 2026-10-20 at `d492a44`):

- `scripts/run-tests.mjs:38` spawns `node --test <files>` with no `--test-concurrency`, so node sizes its pool
  from the machine (23 workers on the 24-thread workstation the rule was measured on), and nothing lowers it.
- `package.json:52` `build-storybook` (`storybook build`), `:51` `storybook` (dev server), `:53` `layout-check`
  (headless Chrome over 1872 case-states) and `:48` `pack-and-consume` run at normal priority.

Goal: each local entry point above is lowered and, where it starts workers, capped at `min(8, default)`; CI keeps
its own counts and is not throttled; the suite pins the cap and the lowering so a later edit cannot drop them.

## 2. Design (reuse first)

- **The lowering:** copy `.agents/conventions/tools/templates/lower-priority-preload.mjs` verbatim to
  `scripts/lower-priority.mjs`, its one `MOUNT` line set to `.agents/conventions` (the rule's sanctioned shape for
  scripts CI also runs: an absent/empty mount — CI's normal state — lowers nothing; a mount with content but no
  tool fails the run).
- **`run-tests.mjs`:** `await import('./lower-priority.mjs')` before spawning, and pass
  `--test-concurrency=<max(1, min(8, availableParallelism() - 1))>` to `node --test`.
- **`package.json`:** `build-storybook`, `storybook`, `layout-check`, `pack-and-consume` run through
  `node --import ./scripts/lower-priority.mjs <their script or CLI entry>` (Storybook's CLI file resolved from
  `node_modules/storybook`, read from its package, not guessed). `layout-check` and `pack-and-consume` may instead
  import the preload themselves, as run-tests does — whichever keeps the script runnable directly.
- **Children inherit** the lowered priority (Chrome, esbuild, tsc, npm); nothing is lowered after it started.

## 3. Test plan (RED first)

- A test reads `package.json` and asserts each of the four scripts goes through the preload (or its script
  imports it), and `test` runs `scripts/run-tests.mjs`.
- A test runs `scripts/run-tests.mjs` logic as a pure function (extract `concurrency(availableParallelism)`) and
  pins `min(8, n - 1)`, floor 1: 2→1, 4→3, 9→8, 24→8 — never a bare 8 on a 4-vCPU runner.
- A test asserts `scripts/lower-priority.mjs` is byte-identical to the conventions template except its `MOUNT`
  line (so the copy cannot drift).
- Break-its: drop the concurrency flag, drop the preload from one script — each red, restored byte-identical.
- What it cannot prove in CI: the priority itself (CI lowers nothing by design); checked once locally with
  `Get-Process` / `ps -o ni` while the suite runs, recorded in the PR.

## 4. Growth surfaces

None.

## 5. Build order

1. RED tests. 2. The preload copy, run-tests, package.json. 3. GREEN: typecheck, lint, the whole suite (lowered),
build, build-storybook, layout-check. 4. Break-its. 5. README "Develop" and module_tests. 6. coai plan round
before 1, code round after 5, PR (`chore:` or `build:` title — no release), merge on all green.

## 6. Definition of Done

- [ ] Every local entry point named in §1 runs lowered; `node --test` is capped at `min(8, default)`; CI unchanged.
- [ ] The tests of §3 seen RED, then GREEN; break-its red and restored.
- [ ] One local observation of the lowered priority recorded in the PR.
- [ ] Gate rounds `proceed`; merged with every check green; this plan promoted to `research/`.
