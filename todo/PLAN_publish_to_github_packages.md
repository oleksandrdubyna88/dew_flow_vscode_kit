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
| `.github/workflows/release.yml:81-163` (publish job) | `NPM_TOKEN` check step (:97-110); setup-node `registry-url: https://registry.npmjs.org` (:124); `npm publish --provenance --access public` with `NODE_AUTH_TOKEN: secrets.NPM_TOKEN` (:145-148); `id-token: write` only | no token check; setup-node `registry-url: https://npm.pkg.github.com`, `scope: '@oleksandrdubyna88'`; guard → `npm ci` → `npm test` → **Pack** (one `npm pack --pack-destination "$RUNNER_TEMP/release"`, asserts exactly one `.tgz`, writes `tarball=<path>` to `$GITHUB_OUTPUT`) → **Attest** (`actions/attest-build-provenance@4d101475d8b20a2381f78447822ac1eab6504dd8 # v4.2.2`, `subject-path: ${{ steps.pack.outputs.tarball }}`) → **Publish** (`npm publish "$TARBALL"`, `TARBALL` = that same output, `NODE_AUTH_TOKEN: ${{ secrets.GITHUB_TOKEN }}`) → **Verify** (`verify-published.mjs --tarball "$TARBALL" --check version --check integrity --check attestation`, `NODE_AUTH_TOKEN` and `GH_TOKEN` from the job token) → **Consume** (`pack-and-consume.mjs --published`, `NODE_AUTH_TOKEN`). Job permissions exactly `contents: read`, `packages: write`, `id-token: write`, `attestations: write`. `environment: npm` KEPT — it holds no secret now, its `v*`-tag-only deployment rule is the fence, and keeping the name means the owner recreates nothing. Header comment rewritten. |
| `scripts/lib/npm.mjs` | `anonymousEnv(dir)` — no token, empty user config | `registryEnv(dir, manifest)` — `npm_*` removed, user config = a file in `dir` holding `<scope>:registry=<publishConfig.registry>` and `//<host>/:_authToken=${NODE_AUTH_TOKEN}` (the LITERAL `${…}`: npm expands it, so the token is never written to disk), both derived from `package.json`, never retyped. Refuses (thrown error → exit 2 at the callers) when `NODE_AUTH_TOKEN` is empty, naming what to set: in CI a `GITHUB_TOKEN` with `packages: read`, locally a classic PAT with `read:packages`. A developer's own `~/.npmrc` still cannot change what is asked. `anonymousEnv` is removed (no caller left). |
| `scripts/verify-published.mjs` | checks `version`, `provenance` (npm SLSA statement via `dist.attestations`), `signatures` (`npm audit signatures`) against npmjs anonymously | checks **`version`** (`npm view <name>@<v> --json` on the GitHub registry, retried as today), **`integrity`** (the SERVED tarball, downloaded with `npm pack <name>@<v>`: its sha512 equals `dist.integrity`; with `--tarball <file>` that file's sha512 equals it too — the bytes attested are the bytes served), **`attestation`** (`gh attestation verify <served tgz> --repo <owner>/<repo> --cert-identity https://github.com/<owner>/<repo>/.github/workflows/release.yml@refs/tags/v<v> --deny-self-hosted-runners --format json`, exe + argv under a timeout; the decision does not trust the flags alone — it also reads the output back: exit 0, an entry whose certificate `subjectAlternativeName` is that identity, `runnerEnvironment` `github-hosted`, predicate SLSA v1, and a subject whose `sha256` is the served file's), **`visibility`** (`gh api /users/<owner>/packages/npm/<name>` answers `visibility: public`; needs `read:packages`, so release.yml does not run it — POST_DEPLOY does). `--check` repeatable, default all four. `--facts` kept. Owner/repo from `repository.url`, scope and registry from `package.json`. npmjs-only code deleted. |
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
  publish step's `TARBALL` is that SAME expression and its run is `npm publish "$TARBALL"`; no `--provenance`,
  no `--access` anywhere;
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

## 10. Definition of Done

- [ ] Every test in §7 written first and observed RED with the real symptom; then GREEN.
- [ ] Break-its of §5.4 each observed red, each file restored and `cmp`-identical to its saved copy.
- [ ] typecheck, lint, the whole suite, actionlint: green; observed numbers in the PR.
- [ ] No `NPM_TOKEN` anywhere in workflows, scripts, package.json; no `--provenance`/`--access`.
- [ ] README, POST_DEPLOY.md, research/architecture.md, research/module_tests.md, PLAN_extract_the_kit.md updated;
      trusted publishing recorded as superseded with the reason; the boundary table on both sides.
- [ ] Gate: plan round `proceed`, code round resolved; own Opus review done.
- [ ] Private-data scan of the diff clean; PR squash-merged with every check green.
- [ ] release-please proposes 0.1.1 (observed, not merged).
