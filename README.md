# Valtren AI Extension Tools

[![CI](https://github.com/valtren-ai/vscode-valtren-extension-tools/actions/workflows/ci.yml/badge.svg)](https://github.com/valtren-ai/vscode-valtren-extension-tools/actions/workflows/ci.yml)
[![Publish VS Code Extension](https://github.com/valtren-ai/vscode-valtren-extension-tools/actions/workflows/publish.yml/badge.svg)](https://github.com/valtren-ai/vscode-valtren-extension-tools/actions/workflows/publish.yml)

Scaffold Valtren AI extensions directly from VS Code, connect to a real Valtren organization, and browse live semantic tables and fields while you author extension logic.

This extension builds on the published scaffold CLI:

- [create-valtren-extension](https://www.npmjs.com/package/create-valtren-extension)

It is designed for teams who want a lightweight editor workflow without duplicating scaffold logic across the SDK, public examples, and Marketplace tooling.

## Commands

- `Valtren AI: Create Extension`
  - prompts for extension name and runtime
  - opens a folder picker
  - runs `npx create-valtren-extension ...` in a VS Code terminal
- `Valtren AI: Connect to Organization`
  - stores your Valtren base URL and API token securely in VS Code SecretStorage
  - validates the token against your organization
- `Valtren AI: Show Connected Organization`
  - shows the active org, roles, and quick actions
- `Valtren AI: Disconnect from Organization`
  - clears the saved token and cached semantic metadata
- `Valtren AI: Validate Current Extension`
  - detects the extension root, runtime, entry file, and packageability
- `Valtren AI: Package Current Extension`
  - creates an org-ready ZIP under `.valtren/dist/` in the current workspace
- `Valtren AI: Upload Extension ZIP to Valtren`
  - packages the current workspace and uploads it directly to the connected org
- `Valtren AI: Browse Semantic Tables`
  - loads live semantic tables from your connected Valtren org
- `Valtren AI: Browse Semantic Fields`
  - loads live table.field references from your connected Valtren org
- `Valtren AI: Insert Semantic Table`
  - inserts the selected semantic table name into the active editor
- `Valtren AI: Insert Semantic Field`
  - inserts the selected `table.field` reference into the active editor
- `Valtren AI: Refresh Semantic Cache`
  - refreshes semantic metadata from the platform
- `Valtren AI: Open Extension Examples`
  - opens the public examples repo in the browser

## Secure connection model

- API tokens are stored in VS Code `SecretStorage`, not in your workspace files.
- The extension currently uses:
  - `POST /api/org/context`
  - `POST /api/data-semantics/overview`
  - `POST /api/platform/version`
- Semantic data is cached locally in VS Code storage for faster authoring.

## Why this extension stays lightweight

This extension does not re-implement scaffolding logic. It calls the published Valtren CLI so the SDK remains the source of truth, then layers secure platform connectivity and semantic browsing on top.

## Current runtime templates

- `node-pack`
- `org-zip-node`
- `org-zip-python`
- `sidecar-python`
- `sidecar-java`
- `sidecar-dotnet`

## Recommended flow

1. Run `Valtren AI: Create Extension`
2. Run `Valtren AI: Connect to Organization`
3. Pick the runtime that matches your team and deployment model
4. Use `Insert Semantic Table` and `Insert Semantic Field` while writing logic
5. Cross-check the public guides in [valtren-ai/extension-examples](https://github.com/valtren-ai/extension-examples)
6. Validate, smoke-test, and version the extension before production rollout

## Current workbench scope

This release adds the first real `Valtren Extension Workbench` slice:

- secure org connection
- status-bar connection summary
- local extension validation
- local extension ZIP packaging
- direct ZIP upload to a connected Valtren org
- live semantic table browsing
- live semantic field browsing
- editor insertion commands

Next steps will add:

- trigger org smoke tests from VS Code
- browse uploaded extension source

## Support

- Report issues: [GitHub Issues](https://github.com/valtren-ai/vscode-valtren-extension-tools/issues)
- Extension Marketplace listing: [Visual Studio Marketplace](https://marketplace.visualstudio.com/items?itemName=valtren-ai.vscode-valtren-extension-tools)

## Versioning

- This extension follows semantic versioning.
- See [CHANGELOG.md](./CHANGELOG.md) for release notes and upgrade guidance.
