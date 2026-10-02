# Post-deploy checks — dew_flow_vscode_kit

Target: the package as npmjs serves it — `@oleksandrdubyna88/vscode-webview-kit`.
Last verified: never — nothing published yet.

| # | What a person loses if this is broken | Check | Auto |
|---|---|---|---|
| 1 | A consumer installs a version that is not the one released | `npm view @oleksandrdubyna88/vscode-webview-kit version` equals the release tag | auto |
| 2 | A consumer gets a package without its compiled code or types | `npm pack @oleksandrdubyna88/vscode-webview-kit --dry-run` lists `dist/index.js` and `dist/index.d.ts` | auto |
