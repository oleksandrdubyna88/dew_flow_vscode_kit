# Post-deploy checks — dew_flow_vscode_kit

Target: the package as npmjs serves it — `@oleksandrdubyna88/vscode-webview-kit`; `$TARGET` is the version just released, without the `v` (`0.1.0`). Run from a checkout of that version's tag: `node .agents/conventions/tools/post-deploy-check.mjs --target 0.1.0 --timeout 300000`. `release.yml` runs the same four commands right after it publishes; this file is how a person runs them afterwards and records what they watched.
Last verified: never, as of 2026-10-02 — nothing is published yet.

| # | What a person loses if this is broken | Check | Auto |
|---|---|---|---|
| 1 | A consumer installs a version that is not the one released — the registry does not serve it | `node scripts/verify-published.mjs --check version` | auto |
| 2 | A consumer cannot trace the package to this repository's `release.yml` at the release tag, or the served bytes are not the ones the provenance is about | `node scripts/verify-published.mjs --check provenance` | auto |
| 3 | npm cannot verify the registry signature and the attestation of what a consumer installs | `node scripts/verify-published.mjs --check signatures` | auto |
| 4 | A consumer gets a package without its compiled code or types, or one that does not type-check, bundle and run inside an extension | `node scripts/pack-and-consume.mjs --published` | auto |
