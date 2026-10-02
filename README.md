# dew_flow_vscode_kit

`@oleksandrdubyna88/vscode-webview-kit` — shared webview building blocks for the dew_flow family of
VS Code extensions.

| Part | What it gives an extension |
|---|---|
| `help` | a help page: typed articles (*what it is → why → setup → usage → what can go wrong*), five languages, a visible "not translated yet" fallback, **stale-translation detection** by digest, search, client-side routing, CSP with a nonce |
| `display` | the ± text size and ± text tone controls every page carries, their CSS and page script, and the host half that keeps every open page in step with one global setting |
| `settings` | one reporter for "a view setting could not be saved" |
| `webview` | `escapeHtml`, `jsonForScript`, a nonce, and the ordered write queue |

Extracted from ConnectOtherAIs on 2026-10-02; consumers: ConnectOtherAIs, wsl_care.

**Status:** being built — see [todo/PLAN_extract_the_kit.md](todo/PLAN_extract_the_kit.md).

## Use

```bash
npm install --save-dev @oleksandrdubyna88/vscode-webview-kit
```

The package is bundled into the extension by esbuild (`--external:vscode`), so it adds nothing to the
`.vsix` beyond the code actually used.

## Develop

See [.agents/PROJECT.md](.agents/PROJECT.md) for the commands and the rules this repository follows.

## License

MIT
