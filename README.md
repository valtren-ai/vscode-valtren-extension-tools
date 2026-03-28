# Valtren Extension Tools

Lightweight VS Code commands for creating Valtren AI extensions.

## Commands

- `Valtren: Create Extension`
  - prompts for extension name and runtime
  - opens a folder picker
  - runs `npx create-valtren-extension ...` in a VS Code terminal
- `Valtren: Open Extension Examples`
  - opens the public examples repo in the browser

## Why this extension is lightweight

This extension does not re-implement scaffolding logic. It calls the published Valtren CLI so the SDK remains the source of truth.

## Current runtime templates

- `node-pack`
- `org-zip-node`
- `org-zip-python`
- `sidecar-python`
