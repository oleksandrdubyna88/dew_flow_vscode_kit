# PLAN — no dependency code runs beside the publish credentials: split release.yml's publish job

> Status: **plan only, nothing implemented yet, 2026-10-17.** Scope: `.github/workflows/release.yml`,
> `src/test/releaseWorkflows.test.ts`, README "Release and rollback", POST_DEPLOY.md (where item 5 runs),
> research/architecture.md, research/module_tests.md. Follows
> [PLAN_publish_to_github_packages.md](PLAN_publish_to_github_packages.md), whose report named this hardening;
> the coordinator ordered it before 0.2.0.

## 1. Symptom and goal

Today (`release.yml` at `ca79071`, the `publish` job, :91-190) ONE job holds `packages: write`, `id-token: write`
and `attestations: write` AND runs `npm ci` (:133) and `npm test` (:136), then `npm pack` (:142, whose `prepack`
runs `npm run build`), then attests (:159), publishes (:166), verifies (:175) and runs the consumer fixture
(:185, which bundles with the installed esbuild and type-checks with the installed TypeScript). Every
devDependency — and every package they pull — therefore executes in the process tree that holds the token able
to publish this package and the OIDC token able to sign its provenance. A compromised devDependency could publish
other bytes, or sign an attestation for bytes it chose.

Goal — what must be true when this plan is done:

1. **The job that holds `packages: write`, `id-token: write` or `attestations: write` runs no dependency code**:
   no `npm ci` / `npm install` / `npm test` / `npm run` / `npm pack` / `npm exec` / `npx`, no `cache:`, nothing
   from `node_modules`. It runs only node built-ins and this repository's own scripts (`publish-once.mjs`,
   `verify-published.mjs`, `lib/npm.mjs` — node built-ins, the npm CLI that ships with node, and `gh`), the
   attest action, and `sha256sum`.
2. **The bytes are made in an unprivileged job** (`build`: `contents: read` only): the guard again, `npm ci`,
   `npm test`, ONE `npm pack`, a `.sha256` beside it, both uploaded as one artifact.
3. **The privileged job (`publish`) works on exactly those bytes**: it downloads the artifact, checks the
   `.sha256` before anything else, attests that tarball, publishes it once (`publish-once.mjs`), and verifies what
   GitHub Packages serves against it — the same three checks as today.
4. **The consumer fixture against the published version moves to its own unprivileged job** (`consume`:
   `contents: read`, `packages: read`, `needs: publish`), because it needs `npm ci` (TypeScript and esbuild).
5. Every guarantee `releaseWorkflows.test.ts` holds today still holds, re-stated where the job changed, and the
   suite gains a test that fails the moment a privileged job runs dependency code.

Constraints: the attestation identity does not change (still `release.yml@refs/tags/v<version>`, GitHub-hosted —
`verify-published.mjs` is untouched); `environment: npm` stays on the publish job; no release is cut by this change
(commit type `ci:`, which release-please hides); actions pinned by SHA.

**Re-runs get better, not worse:** "Re-run failed jobs" on a failed `publish` downloads the SAME artifact (the
bytes no longer get re-packed), so `publish-once` skips a version already served and `verify` compares it with
the same file. "Re-run all jobs" rebuilds and can produce other bytes; `verify` then refuses them, as today —
the README says to re-run failed jobs only (the same advice a sibling repository's release documents).

## 2. Precedent (reuse first)

`wsl_care · .github/workflows/release-extension.yml:176-300` (read 2026-10-16): a `build` job packages ONCE and
uploads the package with its `.sha256` (`actions/upload-artifact@cf430e030ddbb5b0abf93d22962f4752f3646cd9 #
v7.0.2`, `retention-days: 7`, `if-no-files-found: error`); an `attest` job holding `id-token`/`attestations` checks
out `.github/scripts` alone ("nothing here can be installed"), downloads the artifact
(`actions/download-artifact@9000827ccba6bdab643e8b6fd33ac0654aef8333 # v8.0.2`), re-checks it and attests it.
Both SHAs were verified against the actions' `v7.0.2` / `v8.0.2` tags on 2026-10-17. This plan follows that
shape; it keeps attest and publish in ONE job, because the attested file and the published file must be the same
object and the job already holds both permissions only for that.

## 3. The jobs after the change

| Job | needs | permissions | runs |
|---|---|---|---|
| `guard` | — | `contents: read` | unchanged |
| `pack-and-consume` | guard | `contents: read` | unchanged (reusable; the pre-publish check on both OSes) |
| `build` (new) | guard | `contents: read` | checkout of the tag (full history, no credentials) → setup-node (no `registry-url`, no `cache`) → the guard again → `npm ci` → `npm test` → `id: pack`: ONE `npm pack --pack-destination "$RUNNER_TEMP/release"`, exactly one `.tgz`, `sha256sum` into `<tgz>.sha256`, `tarball=<basename>` to `$GITHUB_OUTPUT` → upload-artifact `name: release-tarball`, `path: ${{ runner.temp }}/release/`, `if-no-files-found: error`, `retention-days: 7`; job `outputs.tarball` |
| `publish` | guard, pack-and-consume, build | `contents: read`, `packages: write`, `id-token: write`, `attestations: write`; `environment: npm` | checkout with `sparse-checkout: scripts` (cone mode brings the root `package.json`), no credentials → setup-node as today (`registry-url`, `scope`, no `cache`) → download-artifact `release-tarball` into `from-build` → `id: tarball`: `cd from-build && sha256sum -c "$TARBALL.sha256"` (env `TARBALL: ${{ needs.build.outputs.tarball }}`), and `path=<abs path>` to `$GITHUB_OUTPUT` → attest `subject-path: ${{ steps.tarball.outputs.path }}` → `node scripts/publish-once.mjs "$TARBALL"` → `node scripts/verify-published.mjs --tarball "$TARBALL" --check version --check integrity --check attestation` (both with `TARBALL: ${{ steps.tarball.outputs.path }}`, tokens as today) |
| `consume` (new) | guard, publish | `contents: read`, `packages: read` | checkout → setup-node → `npm ci` → `node scripts/pack-and-consume.mjs --published` with `NODE_AUTH_TOKEN: ${{ secrets.GITHUB_TOKEN }}`, `TARGET: ${{ needs.guard.outputs.version }}` |

`publish-once.mjs` already refuses a tarball whose basename is not `npm pack`'s name for the tag's `package.json`,
so a stray file in the artifact cannot be published in its place.

## 4. Test plan (RED first, `src/test/releaseWorkflows.test.ts`)

New, each written and observed RED against `ca79071` before the workflow changes:

- **H1 — no privileged job runs dependency code.** For EVERY workflow and EVERY job whose permissions grant any of
  `packages: write`, `id-token: write`, `attestations: write`: no step `run` matches
  `/\bnpm\s+(ci|install|i|test|t|run|run-script|pack|exec|x)\b|\bnpx\b|\byarn\b|\bpnpm\b|node_modules/`, and no
  `setup-node` step has `cache`. RED today: `release.yml publish runs dependency code: Install, Test, Pack once …`.
- **H1b — the scan still finds what it forbids** (the companion of a structural test): the `build` job's runs DO
  match that pattern (`npm ci`, `npm test`, `npm pack`) — so the pattern is alive. RED today: no `build` job.
- **H2 — the bytes are made unprivileged:** the `build` job's permissions are exactly `{ contents: read }`; it holds
  the ONE `npm pack` of the whole workflow (`id: pack`), writes the `.sha256` and `tarball=` output, and its
  upload-artifact step uses `actions/upload-artifact@<40 hex>` with `if-no-files-found: error` and a
  `retention-days`. RED today: no `build` job.
- **H3 — the privileged job works on those bytes:** `publish` needs `build`; its download-artifact step names the
  SAME artifact `name` the build uploaded; the `sha256sum -c` step comes before the attest step; the attest
  `subject-path`, the publish step's `TARBALL` and the verify step's `TARBALL` are ONE expression
  (`${{ steps.tarball.outputs.path }}`); order download < check < attest < publish < verify. RED today.
- **H4 — the privileged job checks out scripts only:** its checkout has `sparse-checkout` naming `scripts` and
  `persist-credentials: false`. RED today.
- **H5 — the consumer fixture runs unprivileged, after the publish:** a job other than `publish` runs
  `pack-and-consume.mjs --published`, needs `publish`, has exactly `{ contents: read, packages: read }`, and
  `NODE_AUTH_TOKEN` is `${{ secrets.GITHUB_TOKEN }}` there. RED today.

Re-stated (today's A-tests whose job moved — the guarantee stays, the place changes): A2 (`packages`/`id-token`/
`attestations` granted in `publish` alone), A4 (ONE pack in the whole workflow, now in `build`), A5 (one expression
for attest / publish / verify), A6 (`NODE_AUTH_TOKEN` on publish, verify and consume steps only, always the job
token; `GH_TOKEN` on verify only), A8 (`environment: npm`, needs). Their RED is the moved step; their GREEN the new
shape.

Break-its (product file only, each restored and byte-compared): `npm ci` added to `publish` → H1; `cache: npm` on
publish's setup-node → H1; attest's `subject-path` pointing at another file → H3; the `sha256sum -c` step moved
after attest → H3; `packages: write` added to `build` → H2/A2; the consume step moved back into `publish` → H1 and
H5; the sparse-checkout removed → H4.

Also: `actionlint` (1.7.12, with shellcheck) over every workflow; typecheck, lint, the whole suite.

What the suite cannot prove: that the artifact round trip works on a real runner (first observed at the next
release), and anything about what a devDependency would do — only that none runs in the privileged job.

## 5. Docs

README "Release and rollback": the four jobs and why; "When a publish fails" → re-run FAILED jobs (the artifact is
re-used, nothing re-packed), never "Re-run all jobs" after a publish. POST_DEPLOY.md: item 5's sentence says the
`consume` job runs it. research/architecture.md: the release diagram and section. research/module_tests.md: H1-H5.
[PLAN_publish_to_github_packages.md](PLAN_publish_to_github_packages.md): one line pointing here as the hardening
it named.

## 6. Growth surfaces

One artifact per release run (one tarball of ~100 KB and its `.sha256`), `retention-days: 7`, retired by GitHub.
It is never a rollback source: the registry is.

## 7. Build order

1. H1–H5 and the re-stated A-tests, RED, recorded. 2. `release.yml`. 3. GREEN + actionlint + whole suite.
4. Break-its. 5. Docs. 6. Code round, PR (`ci:` title), merge with every check green.

## 8. Definition of Done

- [ ] H1–H5 observed RED with the real symptom, then GREEN; every break-it red and restored byte-identical.
- [ ] typecheck, lint, the whole suite, actionlint green; numbers in the PR.
- [ ] No privileged job in any workflow runs dependency code; the build job holds the one pack.
- [ ] README, POST_DEPLOY.md, research docs updated; the parent plan points here.
- [ ] Gate: plan round `proceed`, code round resolved; own Opus review.
- [ ] PR squash-merged with every check green; no release cut by it.
