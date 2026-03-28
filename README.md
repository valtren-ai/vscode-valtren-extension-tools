# Valtren AI Extension Tools

[![CI](https://github.com/valtren-ai/vscode-valtren-extension-tools/actions/workflows/ci.yml/badge.svg)](https://github.com/valtren-ai/vscode-valtren-extension-tools/actions/workflows/ci.yml)
[![Publish VS Code Extension](https://github.com/valtren-ai/vscode-valtren-extension-tools/actions/workflows/publish.yml/badge.svg)](https://github.com/valtren-ai/vscode-valtren-extension-tools/actions/workflows/publish.yml)

Scaffold Valtren AI extensions directly from VS Code using the official `create-valtren-extension` CLI.

This extension builds on the published scaffold CLI:

- [create-valtren-extension](https://www.npmjs.com/package/create-valtren-extension)

It is designed for teams who want a lightweight editor workflow without duplicating scaffold logic across the SDK, public examples, and Marketplace tooling.

## Commands

- `Valtren AI: Create Extension`
  - prompts for extension name and runtime
  - opens a folder picker
  - runs `npx create-valtren-extension ...` in a VS Code terminal
- `Valtren AI: Open Extension Examples`
  - opens the public examples repo in the browser

## Why this extension is lightweight

This extension does not re-implement scaffolding logic. It calls the published Valtren CLI so the SDK remains the source of truth.

## Current runtime templates

- `node-pack`
- `org-zip-node`
- `org-zip-python`
- `sidecar-python`
- `sidecar-java`
- `sidecar-dotnet`

## Recommended flow

1. Run `Valtren AI: Create Extension`
2. Pick the runtime that matches your team and deployment model
3. Use the generated scaffold as your starting point
4. Cross-check the public guides in [valtren-ai/extension-examples](https://github.com/valtren-ai/extension-examples)
5. Validate, smoke-test, and version the extension before production rollout

## Support

- Report issues: [GitHub Issues](https://github.com/valtren-ai/vscode-valtren-extension-tools/issues)
- Extension Marketplace listing: [Visual Studio Marketplace](https://marketplace.visualstudio.com/items?itemName=valtren-ai.vscode-valtren-extension-tools)

## Versioning

- This extension follows semantic versioning.
- See [CHANGELOG.md](./CHANGELOG.md) for release notes and upgrade guidance.
