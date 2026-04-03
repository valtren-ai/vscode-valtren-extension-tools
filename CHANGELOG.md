# Changelog

All notable changes to `vscode-valtren-extension-tools` will be documented in this file.

The format is based on Keep a Changelog and this extension follows Semantic Versioning.

## [0.11.1] - 2026-04-03

### Fixed

- Restored runtime dependency packaging in the published VS Code extension so command activation works correctly after install/update.

## [0.11.0] - 2026-04-03

### Added

- Semantic-aware pattern snippets for common extension authoring flows:
  - risk rule
  - entity mapper
  - case summary
  - timeline projection

### Changed

- Pattern snippets now pick smart default semantic tables and fields from the connected organization catalog.

## [0.10.0] - 2026-04-03

### Added

- Insert-snippet actions directly inside the semantic schema explorer.
- Inline diagnostics for unknown semantic table and `table.field` references inside quoted strings.

### Changed

- The semantic explorer now acts as both a browser and a fast authoring surface.

## [0.9.0] - 2026-04-03

### Added

- Lightweight semantic schema explorer panels for selected tables.
- Snippet-style semantic completion items for fast `table.field` authoring.

### Changed

- The semantics tree now exposes an explicit explorer action per table while preserving field insertion.

## [0.8.0] - 2026-04-03

### Added

- Semantic table autocomplete inside the editor.
- Semantic `table.field` autocomplete after typing `.`.
- Hover documentation for semantic tables and fields.

### Changed

- The extension now activates on startup and when the Valtren workbench view opens, so semantic authoring features are available without a manual warm-up command.

## [0.7.0] - 2026-04-03

### Added

- Dedicated `Valtren AI` activity-bar workbench with tree views for connection, semantics, and uploaded extensions.
- Click-to-insert semantic tables and fields directly from the sidebar.
- Sidebar actions for browsing source and approving, enabling, disabling, and testing uploaded extensions.

### Changed

- Uploaded extension source previews now open in editor tabs instead of only writing to the output channel.

## [0.6.0] - 2026-04-03

### Added

- Browsing uploaded extension source files from the connected Valtren organization.
- Approve, enable, and disable actions for uploaded org extensions from VS Code.

## [0.5.0] - 2026-04-03

### Added

- Listing of uploaded org extensions from the connected Valtren organization.
- Smoke test execution for enabled uploaded extensions directly from VS Code.

## [0.4.0] - 2026-04-03

### Added

- Local extension validation for the current workspace.
- Local ZIP packaging for org-ready Valtren extensions.
- Direct upload of the current extension ZIP to a connected Valtren organization.

## [0.3.0] - 2026-04-03

### Added

- Secure connection flow to a Valtren organization using VS Code SecretStorage.
- Status bar connection summary for the active Valtren org.
- Commands to browse semantic tables and fields from a connected Valtren org.
- Commands to insert semantic table and field references into the active editor.
- Semantic cache refresh command powered by live platform APIs.
## [0.2.2] - 2026-03-28

### Changed

- Replaced the extension icon with the official Valtren AI logo.

## [0.2.1] - 2026-03-28

### Changed

- Reduced icon asset size for cleaner Marketplace packaging.

## [0.2.0] - 2026-03-28

### Added

- Initial VS Code extension release for scaffolding Valtren AI extensions.
- Commands for creating extensions and opening the examples repository.
- Marketplace metadata, badges, release workflow, CI validation, and CODEOWNERS.
