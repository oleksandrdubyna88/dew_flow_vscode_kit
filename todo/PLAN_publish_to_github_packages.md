# PLAN — publish the kit to GitHub Packages, with a GitHub artifact attestation, instead of npmjs

> Status: **plan only, nothing implemented yet, 2026-10-16.** Scope: `package.json`, `.github/workflows/release.yml`,
> `scripts/verify-published.mjs`, `scripts/pack-and-consume.mjs`, `scripts/lib/npm.mjs`, the release tests,
> README, POST_DEPLOY.md, the research docs, and the release section of [PLAN_extract_the_kit.md](PLAN_extract_the_kit.md).
>
> Cross-repository: wsl_care consumes the kit from its W0 (`wsl_care · todo/`); the consumer setup it needs is §6.

## 1. Symptom and goal

The v0.1.0 release run 38925094342 failed twice at `npm publish` with E403: *"Two-factor authentication or granular
access token with bypass 2fa enabled is required"*. Nothing reached any registry. The tag `v0.1.0` and its GitHub
release stay where they are and are never moved or deleted.

The owner decided (2026-10-16): **publish to GitHub Packages (`npm.pkg.github.com`) instead of npmjs.** What must
be true when this plan is done:

1. `package.json` sends a publish to `https://npm.pkg.github.com` (`publishConfig.registry`); the name stays
   `@oleksandrdubyna88/vscode-webview-kit` (GitHub Packages only takes a scope equal to the owner) and
   `repository.url` keeps naming this repository (that field links the package to the repository).
2. `release.yml` publishes with the job's own `GITHUB_TOKEN` (`packages: write`). No npm token exists anywhere:
   no `NPM_TOKEN` secret, check or reference in any workflow, script or test.
3. The published bytes carry a **GitHub artifact attestation** (SLSA v1 provenance through Sigstore, signed with
   the job's OIDC token): the job runs `npm pack` ONCE, attests that tarball with
   `actions/attest-build-provenance`, and publishes THAT tarball with `npm publish <tgz>`.
4. After the publish, the job proves what GitHub Packages SERVES: the version, that the served tarball's
   sha512 equals `dist.integrity` and equals the tarball the job attested, and that
   `gh attestation verify` accepts the SERVED bytes for this repository, `release.yml` and `refs/tags/v<version>`,
   on a GitHub-hosted runner. The consumer fixture then installs the published version and runs.
5. The docs say how a consumer installs (an `.npmrc`, a token in CI, a token locally), what the owner sets up
   (now: only the release App and the `npm` environment's tag rule), and that npm trusted publishing is
   superseded.
6. The next release-please PR proposes **0.1.1**, and its notes say 0.1.0 never reached a registry.

Constraints: fix forward — `v0.1.0` is never re-tagged; nobody publishes from a laptop; no secret is ever printed;
I do not run the release and do not merge the release-please PR.

## 2. What the documentation says (read 2026-10-16, docs.github.com)

| Question | Answer, as written | Source |
|---|---|---|
| Visibility of a package a workflow publishes with `GITHUB_TOKEN` | "by default if a workflow creates a package using the `GITHUB_TOKEN` … The package inherits the visibility and permissions model of the repository where the workflow is run." This repository is public, so 0.1.1 should be **public by itself**. | *Publishing and installing a package with GitHub Actions* |
| …which another page contradicts | "When you first publish a package, the default visibility is private" (npm registry page and access-control page). The workflow-specific sentence is the more specific one; the contradiction is why visibility is CHECKED after the release (§4, POST_DEPLOY item 4), and why the owner's one click is documented: package → *Package settings* → *Danger Zone* → *Change visibility* → *Public*, confirm by typing the name. **Irreversible:** "Once you make a package public, you cannot make it private again." | *Configuring a package's access control and visibility* |
| Does installing a PUBLIC package need a token? | Yes, on the npm registry: "You need an access token to publish, install, and delete private, internal, and public packages." | *Working with the npm registry* |
| Can ANOTHER repository's `GITHUB_TOKEN` install it? | "If the package is public, any workflow running in any repository can download the package." For a private one, only repositories granted read access (*Manage Actions access*). | *Publishing and installing… with GitHub Actions* |
| Token locally | a personal access token (classic) with `read:packages`. | *Working with the npm registry* |
| `--access public` | not mentioned for GitHub Packages; visibility is a GitHub setting. Dropped. | same |
| `--provenance` | npm provenance is an npmjs feature; dropped and replaced by the attestation. | owner's brief |

## 3. What changes, file by file (references verified at `c554a26`)

| File | Today | After |
|---|---|---|
| `package.json` | no `publishConfig` | `"publishConfig": { "registry": "https://npm.pkg.github.com" }`; name and `repository.url` unchanged |
| `.github/workflows/release.yml:81-163` (publish job) | `NPM_TOKEN` check step (:97-110); setup-node `registry-url: https://registry.npmjs.org` (:124); `npm publish --provenance --access public` with `NODE_AUTH_TOKEN: secrets.NPM_TOKEN` (:145-148); `id-token: write` only | no token check; setup-node `registry-url: https://npm.pkg.github.com`, `scope: '@oleksandrdubyna88'`; guard → `npm ci` → `npm test` → **Pack** (one `npm pack --pack-destination "$RUNNER_TEMP/release"`, asserts exactly one `.tgz`, writes `tarball=<path>` to `$GITHUB_OUTPUT`) → **Attest** (`actions/attest-build-provenance@4d101475d8b20a2381f78447822ac1eab6504dd8 # v4.2.2`, `subject-path: ${{ steps.pack.outputs.tarball }}`) → **Publish, once** (`node scripts/publish-once.mjs "$TARBALL"`, `TARBALL` = that same output, `NODE_AUTH_TOKEN: ${{ secrets.GITHUB_TOKEN }}`: when `<name>@<version>` is already served it publishes NOTHING and says so, otherwise `npm publish "$TARBALL"` — plan round finding 0: a publish that succeeded but whose run failed after it must be re-runnable, and the verify step then decides whether the served bytes are this run's attested bytes; a mismatch stays red and is a bad release, fixed forward) → **Verify** (`verify-published.mjs --tarball "$TARBALL" --check version --check integrity --check attestation`, `NODE_AUTH_TOKEN` and `GH_TOKEN` from the job token) → **Consume** (`pack-and-consume.mjs --published`, `NODE_AUTH_TOKEN`). Job permissions exactly `contents: read`, `packages: write`, `id-token: write`, `attestations: write` — GitHub's levels are cumulative, so `packages: write` also reads the package (verify, consume) and `attestations: write` also reads attestations (plan round finding 1, rejected with this reason; observed at the first release). `environment: npm` KEPT — it holds no secret now, its `v*`-tag-only deployment rule is the fence, and keeping the name means the owner recreates nothing. Header comment rewritten. |
| `scripts/lib/npm.mjs` | `anonymousEnv(dir)` — no token, empty user config | `registryEnv(dir, manifest)` — `npm_*` removed, user config = a file in `dir` holding `<scope>:registry=<publishConfig.registry>` and `//<host>/:_authToken=${NODE_AUTH_TOKEN}` (the LITERAL `${…}`: npm expands it, so the token is never written to disk), both derived from `package.json`, never retyped. Refuses (thrown error → exit 2 at the callers) when `NODE_AUTH_TOKEN` is empty, naming what to set: in CI a `GITHUB_TOKEN` with `packages: read`, locally a classic PAT with `read:packages`. A developer's own `~/.npmrc` still cannot change what is asked. **Precedence** (plan round finding 3): in release.yml, setup-node's `.npmrc` (exported as `NPM_CONFIG_USERCONFIG`) is what `npm ci`, `npm pack` and `npm publish` in the job's own steps read; the scripts' npm CHILDREN read only `registryEnv`'s file, because `childEnv` drops every `npm_*` key case-insensitively — `NPM_CONFIG_USERCONFIG` included — before `npm_config_userconfig` is set. A test pins that an upper-case `NPM_CONFIG_USERCONFIG` does not survive. `anonymousEnv` is removed (no caller left). |
| `scripts/publish-once.mjs` (new) | — | `node scripts/publish-once.mjs <tgz>`: reads the version from `package.json`; asks the registry (through `registryEnv`, retried once) whether `<name>@<version>` is served; served → prints that nothing is published, exit 0; not served → `npm publish <tgz>` (exe + argv, timeout, the job's own npm config), exit = npm's. The decision is a pure exported function held by the suite. |
| `scripts/verify-published.mjs` | checks `version`, `provenance` (npm SLSA statement via `dist.attestations`), `signatures` (`npm audit signatures`) against npmjs anonymously | checks **`version`** (`npm view <name>@<v> --json` on the GitHub registry, retried as today), **`integrity`** (the SERVED tarball, downloaded with `npm pack <name>@<v>`: its sha512 equals `dist.integrity`; with `--tarball <file>` that file's sha512 equals it too — the bytes attested are the bytes served), **`attestation`** (`gh attestation verify <served tgz> --repo <owner>/<repo> --cert-identity https://github.com/<owner>/<repo>/.github/workflows/release.yml@refs/tags/v<v> --source-ref refs/tags/v<v> --deny-self-hosted-runners --format json`, exe + argv under a timeout; the decision does not trust the flags alone — it also reads the output back: exit 0, an entry whose certificate `subjectAlternativeName` is that identity, `runnerEnvironment` `github-hosted`, predicate SLSA v1, and a subject whose `sha256` is the served file's), **`visibility`** (`gh api /users/<owner>/packages/npm/<name>` answers `visibility: public`; needs `read:packages`, so release.yml does not run it — POST_DEPLOY does). `--check` repeatable, default all four. `--facts` kept. Owner/repo from `repository.url`, scope and registry from `package.json`. npmjs-only code deleted. |
| `scripts/pack-and-consume.mjs:138-146` | `--published` packs `<name>@<v>` anonymously from npmjs | the same, through `registryEnv` against GitHub Packages; missing `NODE_AUTH_TOKEN` → exit 2 before any step |
| `src/test/fixtures/verify-published-*.json` | recorded from npmjs (`@sigstore/core@3.0.0`) | replaced by a recording made by the script's own gathering where it can run here: the `gh attestation verify --format json` output recorded for a real attested artefact (`cli/cli` v2.97.0, `gh_2.97.0_linux_armv6.tar.gz`, `deployment.yml@refs/heads/trunk` — recorded 2026-10-16, exit 0), and the integrity facts of a real `npm pack` of this repository. The GitHub Packages packument and the packages REST answer cannot be recorded here (no package exists, and this machine's gh token has no `read:packages`) — those facts are built in the documented shape and the test file says so. |

## 4. Docs

- **README** "Use": install from GitHub Packages (§6). "Release and rollback": the steps above; "When a publish
  fails" without NPM_TOKEN; rollback: GitHub Packages versions are not overwritten either (a published version
  cannot be re-published), so fix forward stays; `npm deprecate` against the GitHub registry. "The provenance
  identity" becomes **"The attestation identity"** (repository, `release.yml`, `refs/tags/v<version>`,
  GitHub-hosted runner, how to verify yourself with `gh attestation verify`). "What the owner creates once": the
  App + its two secrets, and the `npm` environment with only the `v*` tag rule (no token). "After 0.1.0: npm
  trusted publishing" → recorded as **superseded 2026-10-16**: the package no longer goes to npmjs, so there is
  nothing to bind; the attestation gives the same who-built-it evidence without any token.
- **POST_DEPLOY.md**: target = the package as GitHub Packages serves it; items 1 version, 2 integrity (served =
  attested), 3 attestation, 4 visibility public (the owner's click if not), 5 the consumer fixture; the commands
  need `NODE_AUTH_TOKEN` (classic PAT, `read:packages`) and a gh login with `read:packages`; stamp text: never
  verified — 0.1.0 never reached a registry.
- **CHANGELOG**: written by release-please; the merge commit's subject carries the note
  (`fix: publish to GitHub Packages with an artifact attestation; 0.1.0 never reached a registry`), which is the
  0.1.1 changelog line.
- **research/architecture.md** (release section, :340-420) and **research/module_tests.md** (:128-160, :199-204,
  :273-292): the new flow, the new checks, and what they do not prove.
- **todo/PLAN_extract_the_kit.md**: §1 goal 1, §3 step 6, §6, E3.S2 and DoD B say npmjs/provenance/NPM_TOKEN/
  trusted publishing; add a dated deviation pointing here, and change DoD B to "0.1.1 published to GitHub
  Packages with an attestation" — **the boundary**:

  | Item | Built by | The other plan's part |
  |---|---|---|
  | registry, attestation, verification, docs of the publish path | this plan | PLAN_extract_the_kit records the switch as a deviation of E3.S2 |
  | the first credentialed release (0.1.1) and POST_DEPLOY stamp | PLAN_extract_the_kit DoD B | this plan only makes it possible |
  | consumer switches (coai, wsl_care) | PLAN_extract_the_kit DoD C / the consumers' plans | this plan documents the consumer setup they need |

  Order: this plan lands first; DoD B then runs on 0.1.1. Disjoint otherwise.

## 5. Build order

1. RED tests (§7) written against today's files; run; record each failure message.
2. `package.json` publishConfig; `lib/npm.mjs` `registryEnv`; `verify-published.mjs`; `pack-and-consume.mjs`;
   the new fixture; `release.yml`.
3. GREEN: typecheck, lint, the whole suite (lowered priority, ≤ 8 workers — `scripts/run-tests.mjs` already caps),
   actionlint over every workflow if available.
4. Break-its on PRODUCT files only (each one edit, watch the named test go red, restore, `cmp` against a saved
   copy): release.yml (move attest after publish; add `packages: write` to the guard job; registry back to
   npmjs; publish a different path than the attested one), package.json (drop publishConfig),
   verify-published.mjs (skip the SAN read-back; skip the `--tarball` comparison), lib/npm.mjs (write the token
   value instead of the `${…}` reference / drop the empty-token refusal).
5. Docs (§4). 6. Gate code round, own review, PR.

## 6. Consumer setup (what wsl_care W0 needs)

- In the consumer repository, a committed `.npmrc`:
  ```
  @oleksandrdubyna88:registry=https://npm.pkg.github.com
  //npm.pkg.github.com/:_authToken=${NODE_AUTH_TOKEN}
  ```
  (measured 2026-10-16 with npm 11.16.0: an unset `NODE_AUTH_TOKEN` in that line does not break other npm
  commands; the scoped request then simply has no token.)
- `npm install --save-dev --save-exact @oleksandrdubyna88/vscode-webview-kit@0.1.1`.
- CI: the job that runs `npm ci` gets `permissions: { contents: read, packages: read }` and
  `env: NODE_AUTH_TOKEN: ${{ secrets.GITHUB_TOKEN }}` on that step (or setup-node with `registry-url:
  https://npm.pkg.github.com` and `scope: '@oleksandrdubyna88'`). Per the docs a PUBLIC package is downloadable
  by any repository's workflow; were it private, the kit's package settings would need *Manage Actions access* →
  add wsl_care. A token is needed either way.
- Locally: `NODE_AUTH_TOKEN` = a classic PAT with `read:packages` (fine-grained tokens are not accepted by the npm
  registry of GitHub Packages).

## 7. Test plan (RED first)

`src/test/releaseWorkflows.test.ts`:
- no `NPM_TOKEN` in any workflow, in `scripts/`, or in `package.json`;
- `packages: write`, `id-token` and `attestations` are keys of the publish job's permissions and of nothing else;
  the publish job's permissions are exactly the four named in §3;
- setup-node `registry-url` equals `package.json`'s `publishConfig.registry` and is `https://npm.pkg.github.com`;
  its `scope` is the scope of `package.json`'s name;
- order guard < `npm test` < pack < attest < publish < verify, consume; the attest step uses
  `actions/attest-build-provenance@<40 hex>`; its `subject-path` is the pack step's `tarball` output, and the
  publish step's `TARBALL` is that SAME expression and its run is `node scripts/publish-once.mjs "$TARBALL"`; no
  `--provenance`, no `--access` anywhere;
- `NODE_AUTH_TOKEN` appears only on publish-job steps and is always `${{ secrets.GITHUB_TOKEN }}`;
- the publish job keeps `environment: npm`;
- the existing guarantees stay (triggers, no pasted expressions, SHA pins, `persist-credentials: false`).

`src/test/releaseConfig.test.ts`: `publishConfig.registry` is `https://npm.pkg.github.com`; the name's scope is
`@` + the owner in `repository.url`.

`src/test/verifyPublished.test.ts` (rewritten over the new fixture): the recorded facts pass all four; refused,
each naming why: a served integrity that differs from the downloaded bytes; a `--tarball` that differs from the
served one; a gh exit ≠ 0; a SAN of another repository / workflow / ref; a self-hosted runner; a subject whose
sha256 is not the file's; visibility `private` (the message names the owner's click); a version not served;
`--check` runs only what it names; usage errors exit 2; and `NODE_AUTH_TOKEN` empty → exit 2 naming both token
kinds, before anything is asked.

`src/test/packaging.test.ts`: `--published 0.1.1` with `NODE_AUTH_TOKEN` empty exits 2 naming the token, before
any step.

`src/test/publishOnce.test.ts`: the decision — served → publish nothing; not served → publish that tarball;
an answer naming another version → publish; usage (no tarball, a missing file) exits 2.

`src/test/npmEnv.test.ts` (or beside the existing users): `registryEnv` writes the `${NODE_AUTH_TOKEN}` REFERENCE,
never the value (a test with a sentinel token asserts the file does not contain it), derives scope and registry
from the manifest, drops `NPM_CONFIG_USERCONFIG` and `npm_config_*` of any case, and refuses an empty token.

What cannot run before the release: the real publish, the attestation of a real tarball, the GitHub Packages
packument shape (`dist.integrity` present), the packages REST answer, and whether visibility is inherited — the
release job's own verify step and POST_DEPLOY are where those are observed. Said in research/module_tests.md.

## 8. Growth surfaces

None new. The pack directory is `$RUNNER_TEMP` (discarded with the runner); the scripts' temporary directories
are removed pass or fail, as today; each release adds one package version and one attestation, kept forever by
design (a version is never re-used; rollback reaches every one).

## 9. Version and release

The commit changes `package.json`, so it is a releasing `fix:`; after the merge, release-please opens
*chore(main): release 0.1.1*. I do not merge it and do not run any release — the coordinator does. 0.1.0 stays
tagged and unpublished.

## 10. Plan round (coai session `505f051d`, 2026-10-16) and the consultant

Verdict `proceed`, gating 4 of threshold 6; **2 of 4 reviewers answered** (codex, one chat preset; kimi was
cancelled at the 10-minute limit, vibe's answer was unparseable).

| # | Finding | Decision |
|---|---|---|
| 0 | a publish that succeeded but whose run failed after it cannot be re-run | **Accepted** — `publish-once.mjs` (§3) |
| 1 | the job token lacks read permissions for verify | **Rejected** — levels are cumulative (`write` ⊇ `read`); one sentence added to §3 |
| 2 | `npm pack name@version` may re-archive the served tarball | **Rejected** — a registry spec is downloaded and integrity-checked, never re-packed; a difference is what the check exists to report |
| 3 | setup-node's `.npmrc` and `registryEnv`'s may conflict | **Accepted** — precedence stated in §3 and pinned by a test |

Question consultant (`8d683f8a…`, one row answered, gpt-6-astra reading this disk): pointed at the sibling
precedent (wsl_care's extension release: pack once, attest, publish, download back and compare; it also splits
build, attest and publish into separate jobs), the sha256-vs-sha512 distinction (already in §3: sha512 binds
served = integrity = local, sha256 binds served = attested subject), `--source-ref` (added), and that visibility
inheritance is unobserved (already checked after the release). Verified against `wsl_care ·
.github/workflows/release-extension.yml:176-300`. The job split is NOT taken: the owner's brief puts the attestation
in the publish job; it is named in the report as a possible hardening.

## 11. Definition of Done

- [ ] Every test in §7 written first and observed RED with the real symptom; then GREEN.
- [ ] Break-its of §5.4 each observed red, each file restored and `cmp`-identical to its saved copy.
- [ ] typecheck, lint, the whole suite, actionlint: green; observed numbers in the PR.
- [ ] No `NPM_TOKEN` anywhere in workflows, scripts, package.json; no `--provenance`/`--access`.
- [ ] README, POST_DEPLOY.md, research/architecture.md, research/module_tests.md, PLAN_extract_the_kit.md updated;
      trusted publishing recorded as superseded with the reason; the boundary table on both sides.
- [ ] Gate: plan round `proceed`, code round resolved; own Opus review done.
- [ ] Private-data scan of the diff clean; PR squash-merged with every check green.
- [ ] release-please proposes 0.1.1 (observed, not merged).

## 12. Stories

Split by Fable (2026-10-16) on the gate operator's order: four stories, no epics, built in order on this one
branch by one Sonnet coder, reviewed by ONE code round at the end — no per-story gate. **S2 is the only
cornerstone**; its full spec (scenarios + brief) is below. The briefs of S1, S3 and S4 are the Opus judge's.

| Id | Title | Cornerstone | Depends on |
|---|---|---|---|
| S1 | The registry: `publishConfig`, `registryEnv`, the consumer fixture against GitHub Packages | no | — |
| S2 | The publish job: pack once, attest, publish once, prove the served bytes are the attested bytes | **yes** | S1 |
| S3 | The documentation of the new publish path | no | S2 |
| S4 | Closing: green, teeth, numbers | no | S1–S3 |

### S1 — The registry: `publishConfig`, `registryEnv`, the consumer fixture against GitHub Packages

- **Goal:** every npm this repository's scripts start talks to GitHub Packages with a token it never writes to
  disk, derived from `package.json` and never retyped; a consumer run without a token stops before any step.
- **Files:** `package.json` (`publishConfig.registry`), `scripts/lib/npm.mjs` (`registryEnv(dir, manifest)`
  replaces `anonymousEnv`; `childEnv` unchanged), `scripts/pack-and-consume.mjs` (`--published` through
  `registryEnv`), `src/test/releaseConfig.test.ts`, `src/test/npmEnv.test.ts` (new), `src/test/packaging.test.ts`.
- **Done when:** the §7 tests for those four files are observed RED then GREEN; `anonymousEnv` has no caller
  and is gone; a sentinel token never appears in the written user config; `NPM_CONFIG_USERCONFIG` (upper case)
  does not survive `childEnv`; `--published 0.1.1` with an empty `NODE_AUTH_TOKEN` exits 2 naming both token
  kinds with nothing on stdout; the lib/npm.mjs and package.json break-its of §5.4 observed red and restored.
- **Contract S2 relies on** (fixed here, so S2 re-discovers nothing): `registryEnv(dir, manifest)` returns a
  child environment (`childEnv()` + `npm_config_userconfig=<dir>/registry.npmrc`) whose file holds exactly
  `<scope>:registry=<manifest.publishConfig.registry>` and `//<host of that registry>/:_authToken=${NODE_AUTH_TOKEN}`
  (the literal reference), and **throws** an `Error` whose message starts `NODE_AUTH_TOKEN is empty` and names
  both token kinds (`GITHUB_TOKEN` with `packages: read` in CI; a classic PAT with `read:packages` locally)
  when `process.env.NODE_AUTH_TOKEN` is unset or empty. It builds the file by template literal, never through
  `String.replace` with a string replacement (the `$` in `${NODE_AUTH_TOKEN}` is a replacement pattern).

### S2 — CORNERSTONE — The publish job: pack once, attest, publish once, prove the served bytes

- **Goal:** `release.yml` publishes with the job's own token and no other; the ONE tarball it packs is the one it
  attests and the one it publishes; after the publish the job proves what GitHub Packages SERVES is that tarball
  (sha512 = `dist.integrity` = the local file) and that the served bytes carry an attestation of exactly the
  intended identity (this repository, `release.yml`, `refs/tags/v<version>`, a GitHub-hosted runner, SLSA v1,
  subject sha256 = the served file). A re-run after a successful publish publishes nothing and still proves.
- **Files:** `.github/workflows/release.yml` (publish job + header), `scripts/publish-once.mjs` (new),
  `scripts/verify-published.mjs` (rewritten), `src/test/fixtures/verify-published-github-packages.json` (new;
  `verify-published-sigstore-core-3.0.0.json` deleted), `src/test/releaseWorkflows.test.ts`,
  `src/test/publishOnce.test.ts` (new), `src/test/verifyPublished.test.ts` (rewritten).
- **Why this is the cornerstone:** it is the whole security surface of the plan — the publish job's credentials
  and permissions, the attestation identity, and what the verifier refuses. The consultant's four expensive
  mistakes (§10) all live here: attesting one archive and publishing another; "already published" taken as
  success without reading the served bytes; a valid attestation that is not the intended identity; a package
  that publishes but no consumer can install (the consume step is the last step of this job).
- **Done when:** every scenario below observed RED with the recorded symptom, then GREEN; every break-it below
  observed red and the file restored `cmp`-identical; `npm publish --dry-run <tgz>` run locally once to confirm
  that publishing a tarball runs no lifecycle script (the brief's assumption, §12 S2.c.1 note); typecheck and
  lint green.
- **Depends on:** S1 (`registryEnv`, `publishConfig`).

#### S2.a — Test scenarios (each named after the guarantee; RED = today's code: npmjs + NPM_TOKEN + provenance)

Group A — `src/test/releaseWorkflows.test.ts`. Read through `workflowYaml.ts` as today. The four existing tests
that pin today's shape are REPLACED by A1–A7 (their names: *…id-token: write is granted to the publish job alone*,
*…which holds NPM_TOKEN*, *NODE_AUTH_TOKEN comes from secrets.NPM_TOKEN…*, *…first FAILS when NPM_TOKEN is
missing…*); `publishStep()` is rewritten to find the ONE step whose `run` matches `/publish-once\.mjs/`. Every
other test in the file stays as it is and must stay green.

| # | Guarantee (test name) | Assertion | RED today |
|---|---|---|---|
| A1 | **no npm token exists anywhere: `NPM_TOKEN` appears in no workflow, no `.github/scripts/*`, no `scripts/**`, not in `package.json`** | raw text of every file under `.github/workflows`, `.github/scripts`, `scripts` (recursive) and `package.json` contains no `NPM_TOKEN`; `assert.deepEqual(filesWithIt, [])` | red: `['.github/workflows/release.yml']` (header comment, the check step, the publish step) |
| A2 | **the publish job's permissions are exactly `contents: read`, `packages: write`, `id-token: write`, `attestations: write`, and `packages`, `id-token`, `attestations` are keys nowhere else in any workflow** | `assert.deepEqual(publish.permissions, {contents:'read', packages:'write', 'id-token':'write', attestations:'write'})`; for each of the three keys, `keysNamed(flow, file, key)` over EVERY workflow equals `['release.yml.jobs.publish.permissions.<key>']` for release.yml and `[]` elsewhere | red: *Expected values to be strictly deep-equal* — `{contents:'read','id-token':'write'}`; `packages` → `[]` |
| A3 | **setup-node in the publish job points at `package.json`'s `publishConfig.registry`, which is `https://npm.pkg.github.com`, with `scope` = the scope of `package.json`'s name** | `with['registry-url'] === manifest.publishConfig.registry`, `=== 'https://npm.pkg.github.com'`; `with.scope === manifest.name.split('/')[0]` (`@oleksandrdubyna88`) | red: `'https://registry.npmjs.org' !== undefined` (no `publishConfig` yet) and `scope` undefined |
| A4 | **the publish job packs ONCE (`id: pack`, one `npm pack` in the whole job, writes `tarball=` to `$GITHUB_OUTPUT`), then attests with `actions/attest-build-provenance@<40 hex>`, then publishes through `publish-once.mjs`, then verifies, then consumes — in that order, after the guard and `npm test`** | indices: guard < test < pack < attest < publish < verify < consume; `steps.filter(run has /\bnpm pack\b/).length === 1` and it is the step with `id === 'pack'`; its `run` matches `/tarball=.*>> *"\$GITHUB_OUTPUT"/`; attest `uses` matches `/^actions\/attest-build-provenance@[0-9a-f]{40}$/` | red: *the publish job has no step that packs once* |
| A5 | **the attested subject and the published tarball are ONE expression: attest `with['subject-path']`, the publish step's `env.TARBALL` and the verify step's `env.TARBALL` all equal `${{ steps.pack.outputs.tarball }}`; the publish run is exactly `node scripts/publish-once.mjs "$TARBALL"`; verify's run is exactly `node scripts/verify-published.mjs --tarball "$TARBALL" --check version --check integrity --check attestation`** | three `assert.equal` on the expression string; two on the `run` strings | red: *the publish job has no step that attests* (no attest step) |
| A6 | **the job's own token is the only credential: `NODE_AUTH_TOKEN` is set on exactly the publish, verify and consume steps of the publish job, every time as `${{ secrets.GITHUB_TOKEN }}`; `GH_TOKEN` on the verify step only, same value; neither name appears anywhere else in release.yml** | `stringsWith`/`keysNamed` paths equal exactly those three (`NODE_AUTH_TOKEN`) and that one (`GH_TOKEN`); each value equals `'${{ secrets.GITHUB_TOKEN }}'` | red: the publish step's value is `'${{ secrets.NPM_TOKEN }}'` and the verify/consume steps carry none |
| A7 | **no `run:` in any workflow contains `npm publish`, `--provenance` or `--access`; no `run:` contains `${{`** (the existing pasted-expression test stays beside it) | over every job's steps of every workflow: `assert.deepEqual(offending, [])` | red: `['Publish with provenance']` |
| A8 | **the publish job keeps `environment: npm`, needs the guard AND the pack-and-consume call, and the top-level token reads contents only** | the three existing assertions, kept (rename the environment test: "…which holds no secret: its `v*` tag rule is the fence") | green today (kept as a regression guard; the renamed test is the one that goes red on the break-it *environment removed*) |

Group B — `src/test/publishOnce.test.ts` (new). Spawns `node scripts/publish-once.mjs` with `--facts <file>` like
`verifyPublished.test.ts` does, `env: { ...process.env, NODE_AUTH_TOKEN: 'sentinel-never-printed' }`. RED today
for every row: exit 1, `Error: Cannot find module '…/scripts/publish-once.mjs'` (the real symptom: the script does
not exist).

| # | Guarantee | Facts | Assertion |
|---|---|---|---|
| B1 | **a version the registry already serves is published NOTHING, exit 0, and the line says the verify step decides** | `view = {name, version}` equal to `expected` | code 0; stdout matches `/^publish-once: @oleksandrdubyna88\/vscode-webview-kit@0\.1\.1 is already served — publishing nothing; the verify step decides whether the served bytes are this run's attested bytes$/m` and `/^publish-once: decision skip$/m` |
| B2 | **a version the registry does not serve is published — that tarball, by name** | `view = null` | code 0; stdout matches `/^publish-once: …@0\.1\.1 is not served — publishing oleksandrdubyna88-vscode-webview-kit-0\.1\.1\.tgz$/m` and `/^publish-once: decision publish$/m` |
| B3 | **an answer naming another version is "not served" → publish** | `view = {name, version: '0.1.0'}` | as B2 (`decision publish`) |
| B4 | **usage exits 2 before anything is asked: no tarball; two tarballs; a path that does not exist; a file whose basename is not npm's name for `<name>@<version>` of this package.json** | argv `[]`, `['a.tgz','b.tgz']`, `['<tmp>/missing.tgz']`, `['<tmp>/other-name-0.1.1.tgz']` (an existing empty file) | code 2; stderr matches, respectively, `/one tarball is needed/`, `/one tarball is needed, got "a\.tgz b\.tgz"/`, `/does not exist/`, `/is not the tarball npm pack makes for @oleksandrdubyna88\/vscode-webview-kit@<version> \(oleksandrdubyna88-vscode-webview-kit-<version>\.tgz\)/`; stdout `''` |
| B5 | **an empty `NODE_AUTH_TOKEN` exits 2 naming both token kinds, before the registry is asked** (live mode, a correctly named empty `.tgz` in a temp dir, `NODE_AUTH_TOKEN: ''`) | — | code 2; stderr matches `/NODE_AUTH_TOKEN is empty/`, `/packages: read/`, `/read:packages/`; stdout `''`; the sentinel never appears in stdout+stderr in any row |
| B6 | **the token is never printed**: in every row above, `said` does not include the sentinel | — | `assert.ok(!said.includes('sentinel-never-printed'))` folded into the helper |

Group C — `src/test/verifyPublished.test.ts` (rewritten over the new fixture; the old file's tests are deleted
with the old fixture). Helpers `run`, `judge`, `changed` as today; `env: { ...process.env, TARGET: '',
NODE_AUTH_TOKEN: 'sentinel-never-printed' }`. The fixture's `expected` is the recorded artefact's identity (cli/cli,
below), so "passes" means the decision accepts a REAL verified record and each refusal is that record with one
fact changed.

| # | Guarantee | Change to the recorded facts | Assertion | RED today |
|---|---|---|---|---|
| C1 | **the recorded real facts pass all four checks** | none | code 0; stdout matches `/^verify-published: ok — gh@2\.97\.0: version, integrity, attestation, visibility$/m` | exit 1, `provenance: gh@2.97.0 carries no SLSA v1 provenance (dist.attestations)` (today's checks run over the new shape) |
| C2 | **served bytes that are not `dist.integrity` are refused** | `view.dist.integrity = 'sha512-' + Buffer.alloc(64, 7).toString('base64')` | code 1; `/integrity: the served tarball's sha512 is not dist\.integrity/` | exit 2: `--check is one of version, provenance, signatures or all, not "integrity"` (every C row run with `--check` has this RED; rows run without it have C1's) |
| C3 | **the attested tarball that is not the served tarball is refused — the expensive mistake** | `local.sha512 = <another sha512>` | code 1; `/integrity: the attested tarball gh_2\.97\.0_linux_armv6\.tar\.gz is not the served tarball — sha512 differ/` | exit 2 as C2 |
| C4 | **without `--tarball` facts (`local: null`) the integrity check still binds served = packument and passes** | `local = null` | code 0 with `--check integrity` | exit 2 as C2 |
| C5 | **a packument with no sha512 `dist.integrity` is refused** | `delete view.dist.integrity` | code 1; `/integrity: the packument carries no sha512 dist\.integrity/` | exit 2 as C2 |
| C6 | **a `gh attestation verify` exit ≠ 0 is refused, with gh's stderr** | `attestation.status = 1; attestation.stderr = 'Error: no attestations found'` | code 1; `/attestation: gh attestation verify exited 1/` and `/no attestations found/` | exit 2 as C2 |
| C7 | **a certificate of another repository/workflow is refused by name** | `expected.identity = 'https://github.com/oleksandrdubyna88/dew_flow_vscode_kit/.github/workflows/release.yml@refs/heads/trunk'` | code 1; `/no entry's certificate subjectAlternativeName is "https:\/\/github\.com\/oleksandrdubyna88\/dew_flow_vscode_kit\/\.github\/workflows\/release\.yml@refs\/heads\/trunk" \(seen: https:\/\/github\.com\/cli\/cli\/\.github\/workflows\/deployment\.yml@refs\/heads\/trunk\)/` | exit 2 as C2 |
| C8 | **a certificate of another ref is refused** (the SAN is the identity, the ref is read back separately) | `expected.ref = 'refs/tags/v2.97.0'` (identity unchanged) | code 1; `/no entry's certificate sourceRepositoryRef is "refs\/tags\/v2\.97\.0" \(seen: refs\/heads\/trunk\)/` | exit 2 as C2 |
| C9 | **a self-hosted runner is refused** | `attestation.entries[0].verificationResult.signature.certificate.runnerEnvironment = 'self-hosted'` | code 1; `/no entry's certificate runnerEnvironment is "github-hosted" \(seen: self-hosted\)/` | exit 2 as C2 |
| C10 | **a statement that is not SLSA v1 provenance is refused** | `….statement.predicateType = 'https://slsa.dev/provenance/v0.2'` | code 1; `/no entry's statement predicateType is "https:\/\/slsa\.dev\/provenance\/v1"/` | exit 2 as C2 |
| C11 | **a subject whose sha256 is not the served file's is refused** | `served.sha256 = '00'.repeat(32)` (and `local.sha256` the same so integrity stays green) | code 1 with `--check attestation`; `/no entry's statement subject carries sha256 0{64} — the served tarball's/` | exit 2 as C2 |
| C12 | **an empty entry list is refused** | `attestation.entries = []` | code 1; `/attestation: gh answered no attestation entry/` | exit 2 as C2 |
| C13 | **the conditions must hold on ONE entry, not across entries** | `entries = [e1 with runnerEnvironment 'self-hosted', e2 (a deep copy) with predicateType 'v0.2']` | code 1; `/attestation: no single entry meets every condition/` | exit 2 as C2 |
| C14 | **a private package is refused and the message names the owner's click** | `visibility.answer.visibility = 'private'` | code 1; `/visibility: the package is "private", not public — the owner's click: https:\/\/github\.com\/cli\/cli\/pkgs\/npm\/gh → Package settings → Danger Zone → Change visibility → Public \(irreversible\)/` | exit 2 as C2 |
| C15 | **a version not served is refused by the version check** | `view = null` | code 1 with `--check version`; `/version: npm view gh@2\.97\.0 answered nothing — that version is not served/` | green today by accident (same message) — recorded as such; it guards the retained behaviour |
| C16 | **`--check` runs only what it names, and is repeatable** | `attestation.status = 1` | `--check version` → 0; `--check version --check integrity` → 0; `--check version --check attestation` → 1; no `--check` → 1 | exit 2: `--check is one of …` for the repeated form (parseArgs today takes one) |
| C17 | **usage exits 2 before anything is asked**: no version; `v0.1.1`; two versions; an unknown check; `--tarball` naming a file that does not exist; `--facts` with `--tarball` | argv rows as today's usage test plus `['0.1.1','--tarball','<tmp>/missing.tgz']` → `/--tarball <tmp>\/missing\.tgz does not exist/`; `['--facts', f, '--tarball', x]` → `/--facts takes no --tarball/` | code 2 each; stdout `''` | the two new rows: exit 2 with *Unknown option '--tarball'* — a usage error for the wrong reason, so recorded as "red for the wrong reason, right after GREEN of the others" |
| C18 | **an empty `NODE_AUTH_TOKEN` exits 2 naming both token kinds before anything is asked** (live mode, `['0.1.1', '--check', 'version']`, `NODE_AUTH_TOKEN: ''`) | — | code 2; `/could not gather what to check: NODE_AUTH_TOKEN is empty/`, `/packages: read/`, `/read:packages/`; stdout `''` (no "not served yet" line: the throw precedes `view`) | today: the script asks npmjs anonymously — 12 attempts × 10 s; **run this row with a 5 s spawn timeout and assert `code === 2`** — red as `code === null` (killed) |
| C19 | **facts without an expected name and version are refused with 2** | `{ view: null }` | code 2 | green today (kept) |
| C20 | **the token is never printed** | every row | `said` never contains the sentinel | — |

#### S2.b — Facts shape (the contract between `gather`, `verdict` and the fixture)

```jsonc
{
  "$recorded": "…what is real and what is built (below)…",
  "expected": { "name": "gh", "version": "2.97.0", "owner": "cli", "repo": "cli",
                "registry": "https://npm.pkg.github.com", "workflow": ".github/workflows/deployment.yml",
                "ref": "refs/heads/trunk",
                "identity": "https://github.com/cli/cli/.github/workflows/deployment.yml@refs/heads/trunk" },
  "view": { "name": "gh", "version": "2.97.0", "dist": { "integrity": "sha512-X8pR+8Tj8kTTgm00e6CCbvEZnFK6RcFZbq/ArpbjhvglBC4FgMHL9qsaYlM+iBJMULrArp3sxbkzUNZyLdoUEg==" } },
  "served": { "file": "gh_2.97.0_linux_armv6.tar.gz",
              "sha512": "sha512-X8pR+8Tj8kTTgm00e6CCbvEZnFK6RcFZbq/ArpbjhvglBC4FgMHL9qsaYlM+iBJMULrArp3sxbkzUNZyLdoUEg==",
              "sha256": "83698de1d91d201cc3b9d9b0beb346c221cadb53a68fb82f741ef0a0efc4502c" },
  "local":  { "file": "gh_2.97.0_linux_armv6.tar.gz", "sha512": "<same>", "sha256": "<same>" },   // null when no --tarball
  "attestation": { "status": 0, "stderr": "", "entries": [ /* gh attestation verify --format json, verbatim */ ] },
  "visibility": { "status": 0, "answer": { "visibility": "public" } }
}
```

What is REAL in the fixture: `attestation.entries` — the verbatim output of
`gh attestation verify gh_2.97.0_linux_armv6.tar.gz --repo cli/cli --cert-identity https://github.com/cli/cli/.github/workflows/deployment.yml@refs/heads/trunk --source-ref refs/heads/trunk --deny-self-hosted-runners --format json`
(gh 2.97.0, exit 0; the asset from `gh release download v2.97.0 -R cli/cli --pattern gh_2.97.0_linux_armv6.tar.gz`;
the recorder may trim `attestation.bundle` and `statement.predicate` but must keep `verificationResult.signature.certificate`
whole and the full `statement.subject` list of 21 — the served file is subject index 11); `served.sha256` and
`served.sha512`, hashed from that real file — the sha256 is the recorded subject digest, which is what makes C1
a real pass. What is BUILT in the documented shape: `view` (a GitHub Packages packument cannot be recorded
until a package exists; `dist.integrity` is the real file's sha512 so the shape is honest) and `visibility`
(the REST answer needs `read:packages`, which this machine's gh login lacks). The fixture's `$recorded` says
exactly this, with the date. The real entry's shape, as recorded (keys the verdict reads in **bold**):
`[ { attestation: { bundle, bundle_url, initiator }, verificationResult: { mediaType, signature: { certificate:
{ certificateIssuer, **subjectAlternativeName**, issuer, githubWorkflowTrigger, githubWorkflowSHA, githubWorkflowName,
githubWorkflowRepository, githubWorkflowRef, buildSignerURI, buildSignerDigest, **runnerEnvironment**, sourceRepositoryURI,
sourceRepositoryDigest, **sourceRepositoryRef**, sourceRepositoryIdentifier, sourceRepositoryOwnerURI,
sourceRepositoryOwnerIdentifier, buildConfigURI, buildConfigDigest, buildTrigger, runInvocationURI,
sourceRepositoryVisibilityAtSigning } }, verifiedTimestamps, verifiedIdentity, statement: { _type, **subject[]: { name,
digest: { sha256 } }**, **predicateType**, predicate } } } ]`.

#### S2.c — The brief

**1. `.github/workflows/release.yml` — the publish job, exactly.** Guard job and `pack-and-consume` call unchanged.
Header comment rewritten (it must not contain the literal `NPM_TOKEN` — A1 scans raw text; say "no npm token" in
words): what publishes, with the job's own token, to GitHub Packages; pack once → attest → publish once → verify
served = attested → consume; a re-run after a successful publish publishes nothing and verifies; a failed publish is
fixed forward. Note in the header that `npm publish <tarball>` runs NO lifecycle script (npm runs `prepublishOnly`
only for a directory spec), so the tests that guard the published bytes are the job's own `npm test` and the
`prepack` build inside the pack step — confirm once locally with `npm publish --dry-run <tgz>` and record the
line in the PR.

```yaml
  publish:
    name: release · publish to GitHub Packages
    needs: [guard, pack-and-consume]
    runs-on: ubuntu-latest
    timeout-minutes: 20
    # No secret lives here any more. The environment's deployment rule (README, "What the owner creates
    # once") admits `v*` tags only — a fence owned by GitHub's settings rather than by this file.
    environment: npm
    permissions:
      contents: read
      # Publishes to (and, write ⊇ read, reads back from) GitHub Packages with the job's own token.
      packages: write
      # Signs the provenance statement through GitHub's OIDC issuer — here and in no other job.
      id-token: write
      # Stores the attestation on this repository (write ⊇ read: the verify step reads it back).
      attestations: write
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          ref: ${{ github.ref }}
          fetch-depth: 0
          persist-credentials: false

      # `registry-url` + `scope` write the .npmrc that `npm ci`, `npm pack` and `npm publish` in THIS job read
      # (exported as NPM_CONFIG_USERCONFIG); the scripts' own npm children read registryEnv's file instead
      # (plan §3, precedence). No `cache:`: the published bytes come from `npm ci` against the lockfile.
      - uses: actions/setup-node@820762786026740c76f36085b0efc47a31fe5020 # v7.0.0
        with:
          node-version: 22
          registry-url: https://npm.pkg.github.com
          scope: '@oleksandrdubyna88'

      - id: guard
        name: The guard, on the checkout that is published
        env:
          RELEASE_TAG: ${{ github.event.release.tag_name }}
          RELEASE_DRAFT: ${{ github.event.release.draft }}
          RELEASE_PRERELEASE: ${{ github.event.release.prerelease }}
          RELEASE_AUTHOR_TYPE: ${{ github.event.release.author.type }}
        run: node .github/scripts/release-guard.mjs

      - name: Install
        run: npm ci

      - name: Test
        run: npm test

      # ONE tarball (`prepack` builds dist/ inside it), into the runner's temp folder, its path a step OUTPUT:
      # the attest step, the publish step and the verify step all name THIS output, so there is no second
      # archive to confuse with it. Exactly one .tgz, or the run is red here.
      - id: pack
        name: Pack once — the one tarball that is attested, published and verified
        run: |
          set -euo pipefail
          dest="$RUNNER_TEMP/release"
          mkdir -p "$dest"
          npm pack --pack-destination "$dest"
          set -- "$dest"/*.tgz
          if [ "$#" -ne 1 ] || [ ! -f "$1" ]; then
            echo "::error::release: npm pack left $# tarball(s) in $dest, not exactly one"
            exit 1
          fi
          echo "tarball=$1" >> "$GITHUB_OUTPUT"

      # SLSA v1 provenance of that tarball, signed with this job's OIDC token (identity: this repository,
      # release.yml, refs/tags/v<version>, github-hosted) and stored on the repository. Before the publish:
      # a tarball that cannot be attested is never published.
      - uses: actions/attest-build-provenance@4d101475d8b20a2381f78447822ac1eab6504dd8 # v4.2.2
        with:
          subject-path: ${{ steps.pack.outputs.tarball }}

      # Publishes NOTHING when <name>@<version> is already served (a re-run after a publish that succeeded;
      # plan round finding 0) and says so; otherwise `npm publish <that tarball>`. Either way the next step
      # decides whether the served bytes are THIS run's attested bytes.
      - name: Publish, once
        env:
          NODE_AUTH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          TARBALL: ${{ steps.pack.outputs.tarball }}
        run: node scripts/publish-once.mjs "$TARBALL"

      # What GitHub Packages SERVES: the version; the served tarball's sha512 = dist.integrity = the attested
      # file's; `gh attestation verify` of the SERVED bytes against the exact identity, read back from gh's
      # JSON, never trusted from the flags alone. Visibility is POST_DEPLOY's (needs read:packages).
      - name: Verify what GitHub Packages serves — version, integrity (served = attested), attestation identity
        env:
          NODE_AUTH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          TARBALL: ${{ steps.pack.outputs.tarball }}
          TARGET: ${{ steps.guard.outputs.version }}
        run: node scripts/verify-published.mjs --tarball "$TARBALL" --check version --check integrity --check attestation

      # The consumer fixture against the PUBLISHED tarball (POST_DEPLOY.md item 5): downloaded from GitHub
      # Packages, read, installed, type-checked, bundled and run — the same steps the pre-publish check took.
      - name: The consumer fixture against the published version
        env:
          NODE_AUTH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          TARGET: ${{ steps.guard.outputs.version }}
        run: node scripts/pack-and-consume.mjs --published
```

Shapes the YAML subset reader (`workflowYaml.ts`) needs: `scope` QUOTED (`'@…'` — an unquoted `@` is outside
YAML's plain scalars); no `${{` inside any `run:` (`$RUNNER_TEMP`, `$GITHUB_OUTPUT`, `$TARBALL` are shell
variables, which is the point); no flow mappings, anchors or folded scalars. Run `actionlint` over the file if
available.

**2. `scripts/publish-once.mjs` (new).** Header comment in the style of `verify-published.mjs`. Node built-ins only;
imports `{ childEnv, npmCli, registryEnv }` from `./lib/npm.mjs`.

- `readArguments(argv)` with `parseArgs({ allowPositionals: true, options: { facts: { type: 'string' } } })`:
  `--facts <file>` → `{ facts }` (positionals must be empty: `--facts takes no tarball`); else exactly one positional
  → `{ tarball }`; otherwise `{ usage: 'one tarball is needed, got "<positionals joined>"' }`. Then, live mode only:
  the file must exist (`<path> does not exist`), and `basename(tarball)` must equal `packName(manifest)` =
  `` `${name.replace(/^@/, '').replace('/', '-')}-${version}.tgz` `` (`<basename> is not the tarball npm pack makes
  for <name>@<version> (<expected basename>)`). Every usage case: stderr = the reason + `USAGE`, exit 2, nothing on
  stdout. `USAGE = 'usage: node scripts/publish-once.mjs <tarball.tgz> | --facts <file>'`.
- `export function decide(facts)` — pure: `facts.view` is an object whose `name === expected.name && version ===
  expected.version` → `{ action: 'skip', line: '<name>@<version> is already served — publishing nothing; the verify
  step decides whether the served bytes are this run's attested bytes' }`; anything else (null, another version,
  another name) → `{ action: 'publish', line: '<name>@<version> is not served — publishing <expected basename>' }`.
- `gather(expected, dir)`: `env = registryEnv(dir, manifest)` FIRST (its throw → `publish-once: could not ask the
  registry: <message>`, exit 2 — this is B5, before any npm starts); then `npm view <name>@<version> --json` (exe +
  argv: `process.execPath`, `npmCli()`, `cwd: ROOT`, `timeout: 120_000`, `killSignal: 'SIGKILL'`); status 0 with a
  JSON object → that object; status ≠ 0 whose stdout parses to `{ error: { code: 'E404' } }` → `null`; any other
  non-zero → one retry after 10 s, then exit 2 naming the code and the stderr tail (never publish on an answer the
  script did not understand). The temp dir is `mkdtempSync(join(tmpdir(), 'kit-publish-once-'))`, removed in
  `finally`.
- `main`: `--facts` → read the file, require `expected.name`/`expected.version` strings (else exit 2), print
  `publish-once: <line>` then `publish-once: decision <action>`, exit 0, spawn nothing. Live: facts =
  `{ expected: { name, version }, view }` from `package.json` at ROOT + `gather`; print both lines; `skip` → exit 0;
  `publish` → `npm publish <tarball>` with `cwd: ROOT`, `env: registryEnv(dir, manifest)` (the SAME file the question
  used — `childEnv` drops `NPM_CONFIG_USERCONFIG`, so setup-node's .npmrc never reaches this child, by design),
  `timeout: 180_000`; status 0 → `publish-once: published <basename>`, exit 0; else `publish-once: npm publish exited
  <status>` + the last 40 lines of stderr, exit 1. **Deviation from §3 recorded here:** the publish child reads
  `registryEnv`'s config, not "the job's own" (which `childEnv` strips); and a failed npm is exit 1, not npm's own
  code — the 0/1/2 contract of every script here. Never print `process.env`; npm's own output is printed as it is
  (npm redacts tokens).

**3. `scripts/verify-published.mjs` (rewritten; npmjs-only code — `statementOf`, `audit`, `integrityHex`,
`identityProblems`, `subjectProblems`, `provenanceProblems`, `signatureProblems`, `SLSA_V1` as a provenance
URL check on `dist.attestations` — deleted).**

- Constants: `CHECKS = ['version', 'integrity', 'attestation', 'visibility']`, `SLSA_V1`, `GITHUB_HOSTED =
  'github-hosted'`, `WORKFLOW`, timeouts as today plus `GH_TIMEOUT_MS = 120_000`.
- `expectedFor(manifest, version)` → `{ name, version, owner, repo, registry: manifest.publishConfig.registry,
  workflow: WORKFLOW, ref: 'refs/tags/v<version>', identity: 'https://github.com/<owner>/<repo>/<WORKFLOW>@refs/tags/v<version>' }`,
  `owner`/`repo` parsed from `repositoryUrl(manifest.repository)` (kept) — never retyped. `packageName(name)` = the
  npm name without its scope (`vscode-webview-kit`), what GitHub's REST calls the package.
- `readArguments(argv, env)`: `parseArgs({ allowPositionals: true, options: { check: { type: 'string', multiple: true,
  default: [] }, facts: { type: 'string' }, tarball: { type: 'string' } } })`; each `--check` must be in `CHECKS`
  (`--check is one of version, integrity, attestation, visibility, not "<x>"`), none → all four; `--facts` with a
  positional → `--facts takes no version`, with `--tarball` → `--facts takes no --tarball`; version shape as today;
  live `--tarball` must exist → `--tarball <path> does not exist`. `USAGE = 'usage: node scripts/verify-published.mjs
  [<version>] [--tarball <file>] [--check version|integrity|attestation|visibility]... | --facts <file>'`.
- `hashes(file)` → `{ file: basename, sha512: 'sha512-' + base64, sha256: hex }` (`node:crypto`, one read).
- `gather(expected, checks, tarball)`: `dir = mkdtempSync(...)`, `env = registryEnv(dir, manifest)` FIRST (C18);
  `view` when checks ∩ {version, integrity} (the retry loop as today, progress on stdout); `served` when checks ∩
  {integrity, attestation}: `npm pack <name>@<version> --pack-destination <dir>/served` under `env`, then exactly one
  `.tgz` there → `hashes(it)`, else `null` (a failed download is a FACT the decision reports, not a gathering error);
  `local` = `tarball === undefined ? null : hashes(tarball)`; `attestation` when `served !== null` and checks has
  `attestation`: `spawnSync('gh', ['attestation', 'verify', servedPath, '--repo', '<owner>/<repo>', '--cert-identity',
  expected.identity, '--source-ref', expected.ref, '--deny-self-hosted-runners', '--format', 'json'], { cwd: dir,
  env: childEnv(), encoding: 'utf8', timeout: GH_TIMEOUT_MS, killSignal: 'SIGKILL' })` — `result.error` (gh absent)
  → throw `gh did not run: <message> — gh is preinstalled on GitHub-hosted runners; locally install GitHub CLI and
  log in` (exit 2); else `{ status, stderr: tail, entries: status === 0 ? JSON.parse(stdout) : [] }`; `visibility`
  when asked: `spawnSync('gh', ['api', '/users/<owner>/packages/npm/<packageName>'], …)` → `{ status, stderr,
  answer: status === 0 ? JSON.parse(stdout) : null }`. `GH_TOKEN` reaches gh through `childEnv()` as the environment
  carries it; nothing is written to the log but the verdict and the progress lines. `finally` removes `dir`.
- Deciders (each `(facts) → string[]`, each `private static`-style pure, CC ≤ 4 — split per condition):
  - `versionProblems` as today.
  - `integrityProblems`: `served === null` → `['the served tarball was not downloaded — npm pack <name>@<version> left
    nothing']`; `!/^sha512-/.test(view?.dist?.integrity)` → `['the packument carries no sha512 dist.integrity']`;
    `served.sha512 !== view.dist.integrity` → `["the served tarball's sha512 is not dist.integrity (served <a>,
    packument <b>)"]`; `local !== null && local.sha512 !== served.sha512` → `['the attested tarball <local.file> is
    not the served tarball — sha512 differ']`. All that apply, in that order.
  - `attestationProblems`: `served === null` → `['the served tarball was not downloaded, so nothing was verified']`;
    `attestation` null → `['gh attestation verify did not run']`; `status !== 0` → `['gh attestation verify exited
    <status>\n<stderr>']`; `entries` not a non-empty array → `['gh answered no attestation entry']`; else the five
    CONDITIONS, each `{ why, seen: entry → string, ok: entry → boolean }`:
    `subjectAlternativeName === expected.identity`; `runnerEnvironment === 'github-hosted'`; `sourceRepositoryRef ===
    expected.ref`; `statement.predicateType === SLSA_V1`; `statement.subject.some(s => s?.digest?.sha256 ===
    served.sha256)` (paths: `entry.verificationResult.signature.certificate.*`, `entry.verificationResult.statement.*`,
    read with `?.`). If some entry meets ALL five → `[]`. Else: for each condition met by NO entry →
    `no entry's certificate subjectAlternativeName is "<identity>" (seen: <distinct seen values joined ', '>)` /
    `no entry's certificate runnerEnvironment is "github-hosted" (seen: …)` / `no entry's certificate
    sourceRepositoryRef is "<ref>" (seen: …)` / `no entry's statement predicateType is "<SLSA_V1>" (seen: …)` /
    `no entry's statement subject carries sha256 <served.sha256> — the served tarball's`; if that list is empty (every
    condition met somewhere, none everywhere) → `['no single entry meets every condition']`.
  - `visibilityProblems`: null → `['gh api did not run']`; `status !== 0` → `['gh api /users/<owner>/packages/npm/<pkg>
    exited <status>\n<stderr>']`; `answer?.visibility !== 'public'` → `['the package is "<v>", not public — the owner's
    click: https://github.com/<owner>/<repo>/pkgs/npm/<pkg> → Package settings → Danger Zone → Change visibility →
    Public (irreversible)']`.
  - `verdict(facts, checks)` as today: `ok — <name>@<version>: <checks joined>` / `FAILED` + `  - <check>: <why>`.
- `main`: exit 0 / 1 / 2 exactly as today (`could not gather what to check: <message>` for every throw in `gather`,
  which is where `registryEnv`'s empty-token message surfaces).

**4. The fixture** `src/test/fixtures/verify-published-github-packages.json` — S2.b, recorded by the coder with the
command given there (the gh asset is ~14 MB; download to a temp dir outside the repo, hash it, keep only the JSON).
Delete `verify-published-sigstore-core-3.0.0.json`.

**5. Tests to replace.** `releaseWorkflows.test.ts`: the four named in Group A; `verifyPublished.test.ts`: all —
the old tests assert a provenance shape that no longer exists. Each new test is written FIRST and its RED recorded
in the PR (the symptom column above is what to expect; a different symptom is a finding, not a typo).

**6. Break-its** (one product-file edit each; restore; `cmp` against the saved copy; record the red line):

| Edit | Test that goes red |
|---|---|
| release.yml: move the attest step after the publish step | A4 (order: attest index > publish index) |
| release.yml: `packages: write` added to the guard job's permissions | A2 (`packages` keys: two paths) |
| release.yml: setup-node `registry-url: https://registry.npmjs.org` | A3 |
| release.yml: the publish step's `TARBALL` → `$RUNNER_TEMP/release/other.tgz` (a different path than the attested one) | A5 |
| release.yml: `NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}` on the publish step | A1 and A6 |
| release.yml: a second `npm pack` in the verify step's run | A4 (`npm pack` count 2) |
| release.yml: `environment: npm` removed | A8 |
| publish-once.mjs: `decide` always answers `publish` | B1 |
| publish-once.mjs: `decide` always answers `skip` | B2, B3 |
| publish-once.mjs: `registryEnv` moved after `npm view` | B5 (exit 2 still, but the `not served` progress reaches stdout → `stdout === ''` fails; or a timeout) |
| verify-published.mjs: the `subjectAlternativeName` condition removed | C7 |
| verify-published.mjs: the `runnerEnvironment` condition removed | C9 |
| verify-published.mjs: the `sourceRepositoryRef` condition removed | C8 |
| verify-published.mjs: the subject sha256 condition removed | C11 |
| verify-published.mjs: the `local.sha512 !== served.sha512` comparison removed | C3 |
| verify-published.mjs: `.some(meetsAll)` replaced by per-condition "any entry" only | C13 |
| verify-published.mjs: `registryEnv` called after `view` | C18 (the 5 s timeout kills it: `code === null`) |

**7. Conventions held (the existing ones of these scripts, unchanged):** node built-ins only; every child is exe +
argv under a timeout (`process.execPath` + `npmCli()` for npm, `'gh'` for gh — no shell, no command string);
`npm_*` removed from every child environment through `childEnv`/`registryEnv`; no token is ever printed (the
sentinel rows B6/C20 hold it); the decision is a pure function held by the suite through `--facts`; `--facts` mode
spawns nothing; temp directories removed pass or fail; CC ≤ 4 per function (the five attestation conditions are
data, not branches); never `String.replace` with a string replacement that may contain `$`.

### S3 — The documentation of the new publish path

- **Goal:** a reader of README, POST_DEPLOY.md and the research docs finds the publish path as it now is — GitHub
  Packages, the attestation identity, the consumer setup, what the owner creates (only the App and the `npm`
  environment's tag rule), npm trusted publishing recorded as superseded, 0.1.0 recorded as never published — and
  the sibling plan carries the boundary.
- **Files:** `README.md` ("Use" install section; "Release and rollback" onward — including that `npm publish
  <tarball>` runs no lifecycle script, so `prepublishOnly` no longer runs inside the publish), `POST_DEPLOY.md`
  (items 1 version, 2 integrity, 3 attestation, 4 visibility, 5 consumer fixture; the tokens the commands need),
  `research/architecture.md` (:332-402 release section), `research/module_tests.md` (:128-160, :199-204, :273-292),
  `todo/PLAN_extract_the_kit.md` (dated deviation of E3.S2 pointing here; DoD B reworded; the boundary table of §4).
- **Done when:** §4 of this plan is true line by line; no document names `NPM_TOKEN`, `--provenance`, `--access
  public` or `npm audit signatures` as current behaviour; every `gh attestation verify` command a document shows
  pins `--repo`, `--cert-identity …@refs/tags/v<version>`, `--deny-self-hosted-runners` and never `--signer-workflow`;
  the Mermaid diagrams of the release section render; `research/module_tests.md` says what the suite does not prove
  (the real publish, the real attestation, the packument shape, the REST answer, visibility inheritance).
- **Depends on:** S2.

### S4 — Closing: green, teeth, numbers

- **Goal:** the whole plan is observed finished with numbers in the PR, not asserted.
- **Files:** none changed by design (`todo/README.md`'s table and this plan's §11 checkboxes are the only edits);
  `research/module_tests.md` gains the break-it lines if S3 left placeholders.
- **Done when:** `npm run typecheck`, `npm run lint`, `npm test` (whole suite, lowered priority, ≤ 8 workers) and
  `actionlint` over every workflow are green with the counts recorded; every §5.4 break-it (S1's for lib/npm.mjs and
  package.json, S2's table) observed red and each file `cmp`-identical to its saved copy; `pack-and-consume.mjs` (the
  local path, no `--published`) still passes on this machine; the private-data scan of the full diff is clean; §11's
  checkboxes that this branch can satisfy are ticked with the observation beside each; what only the first release
  can observe is listed in the PR body verbatim from §7's last paragraph.
- **Depends on:** S1, S2, S3.
