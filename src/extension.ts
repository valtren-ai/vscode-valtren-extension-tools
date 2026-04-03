import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as vscode from "vscode";
import { zipSync } from "fflate";

type RuntimeTemplate =
  | "node-pack"
  | "org-zip-node"
  | "org-zip-python"
  | "sidecar-python"
  | "sidecar-java"
  | "sidecar-dotnet";

type ValtrenConnection = {
  baseUrl: string;
  apiToken: string;
  orgId?: string;
  orgLabel?: string;
  roleKeys: string[];
  platformVersion?: string;
};

type OrgContextResponse = {
  org_id?: string;
  org_label?: string;
  role_keys?: string[];
  permission_keys?: string[];
};

type PlatformVersionResponse = {
  version?: string;
};

type SemanticOverviewResponse = {
  semantic_fields?: Array<{
    entity_table?: string;
    field_name?: string;
    field_type?: string;
    description?: string;
    display_name?: string;
  }>;
  canonical_tables_default?: Array<{
    table_name?: string;
    display_name?: string;
    description?: string;
  }>;
  canonical_tables_org?: Array<{
    table_name?: string;
    display_name?: string;
    description?: string;
  }>;
};

type SemanticField = {
  tableName: string;
  fieldName: string;
  fieldType: string;
  description: string;
};

type SemanticTable = {
  tableName: string;
  displayName: string;
  description: string;
  fields: SemanticField[];
};

type SemanticCatalog = {
  tables: SemanticTable[];
  refreshedAt: string;
};

type LocalExtensionRuntime = "node" | "python";

type ValidationFinding = {
  key: string;
  status: "passed" | "failed" | "warning";
  detail: string;
};

type ValidationResult = {
  rootPath: string;
  runtime?: LocalExtensionRuntime;
  entryFile?: string;
  findings: ValidationFinding[];
  suggestedName: string;
};

const secretKeys = {
  apiToken: "valtren.apiToken",
  baseUrl: "valtren.baseUrl",
  orgId: "valtren.orgId",
  orgLabel: "valtren.orgLabel",
  roleKeys: "valtren.roleKeys",
  platformVersion: "valtren.platformVersion",
} as const;

const semanticCatalogStateKey = "valtren.semanticCatalog";
const outputChannelName = "Valtren AI";

let outputChannel: vscode.OutputChannel | undefined;
let statusBarItem: vscode.StatusBarItem | undefined;

export function activate(context: vscode.ExtensionContext) {
  outputChannel = vscode.window.createOutputChannel(outputChannelName);
  context.subscriptions.push(outputChannel);

  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  statusBarItem.command = "valtren.showConnection";
  context.subscriptions.push(statusBarItem);

  const register = (command: string, handler: (...args: unknown[]) => unknown) =>
    context.subscriptions.push(vscode.commands.registerCommand(command, handler));

  register("valtren.createExtension", async () => {
    await createExtension();
  });

  register("valtren.openExamples", async () => {
    await vscode.env.openExternal(
      vscode.Uri.parse("https://github.com/valtren-ai/extension-examples"),
    );
  });

  register("valtren.connectOrganization", async () => {
    await connectOrganization(context);
  });

  register("valtren.showConnection", async () => {
    await showConnection(context);
  });

  register("valtren.disconnectOrganization", async () => {
    await disconnectOrganization(context);
  });

  register("valtren.refreshSemanticCache", async () => {
    await refreshSemanticCache(context, true);
  });

  register("valtren.validateCurrentExtension", async () => {
    await validateCurrentExtensionCommand();
  });

  register("valtren.packageCurrentExtension", async () => {
    await packageCurrentExtension();
  });

  register("valtren.uploadExtensionZip", async () => {
    await uploadExtensionZip(context);
  });

  register("valtren.browseSemanticTables", async () => {
    await browseSemanticTables(context, false);
  });

  register("valtren.browseSemanticFields", async () => {
    await browseSemanticFields(context, false);
  });

  register("valtren.insertSemanticTable", async () => {
    await browseSemanticTables(context, true);
  });

  register("valtren.insertSemanticField", async () => {
    await browseSemanticFields(context, true);
  });

  void refreshStatusBar(context);
}

export function deactivate() {
  if (statusBarItem) {
    statusBarItem.dispose();
  }
  if (outputChannel) {
    outputChannel.dispose();
  }
}

async function createExtension() {
  const extensionName = await vscode.window.showInputBox({
    prompt: "Extension name",
    placeHolder: "order-dispatch-pack",
    validateInput: (value) =>
      value.trim() ? undefined : "Please enter an extension name.",
  });

  if (!extensionName) {
    return;
  }

  const runtime = await vscode.window.showQuickPick(
    [
      {
        label: "Node Pack",
        detail: "In-process Valtren pack with workflows, templates, and executors",
        runtime: "node-pack" as RuntimeTemplate,
      },
      {
        label: "Org ZIP Node",
        detail: "Customer-owned Node extension uploaded through Org Settings",
        runtime: "org-zip-node" as RuntimeTemplate,
      },
      {
        label: "Org ZIP Python",
        detail: "Customer-owned Python extension uploaded through Org Settings",
        runtime: "org-zip-python" as RuntimeTemplate,
      },
      {
        label: "Sidecar Python",
        detail: "Python sidecar for analytics or model-heavy domain logic",
        runtime: "sidecar-python" as RuntimeTemplate,
      },
      {
        label: "Sidecar Java",
        detail: "Java sidecar for enterprise integration use cases",
        runtime: "sidecar-java" as RuntimeTemplate,
      },
      {
        label: "Sidecar .NET",
        detail: ".NET sidecar for Microsoft-heavy enterprise teams",
        runtime: "sidecar-dotnet" as RuntimeTemplate,
      },
    ],
    { placeHolder: "Select a Valtren extension runtime" },
  );

  if (!runtime) {
    return;
  }

  const targetUri = await vscode.window.showOpenDialog({
    canSelectFiles: false,
    canSelectFolders: true,
    canSelectMany: false,
    openLabel: "Select target directory",
  });

  if (!targetUri?.length) {
    return;
  }

  const cwd = targetUri[0].fsPath;
  const terminal = vscode.window.createTerminal({
    name: "Valtren Extension Scaffold",
    cwd,
  });

  terminal.show(true);
  terminal.sendText(
    `npx create-valtren-extension ${shellEscape(extensionName)} --runtime ${runtime.runtime}`,
  );
}

async function connectOrganization(context: vscode.ExtensionContext) {
  const existing = await getConnection(context);
  const baseUrlInput = await vscode.window.showInputBox({
    prompt: "Valtren base URL",
    placeHolder: "https://valtren.ai",
    value: existing?.baseUrl ?? "https://valtren.ai",
    validateInput: (value) => {
      try {
        normalizeBaseUrl(value);
        return undefined;
      } catch (error) {
        return error instanceof Error ? error.message : "Enter a valid URL.";
      }
    },
  });

  if (!baseUrlInput) {
    return;
  }

  const apiToken = await vscode.window.showInputBox({
    prompt: "Valtren API token",
    password: true,
    ignoreFocusOut: true,
    value: existing?.apiToken,
    validateInput: (value) =>
      value.trim() ? undefined : "Please enter a Valtren API token.",
  });

  if (!apiToken) {
    return;
  }

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: "Connecting to Valtren AI",
      cancellable: false,
    },
    async () => {
      const baseUrl = normalizeBaseUrl(baseUrlInput);
      const orgContext = await postJson<OrgContextResponse>(baseUrl, "/api/org/context", apiToken, {});
      const versionInfo = await safePostJson<PlatformVersionResponse>(
        baseUrl,
        "/api/platform/version",
        apiToken,
        {},
      );

      const connection: ValtrenConnection = {
        baseUrl,
        apiToken,
        orgId: orgContext.org_id,
        orgLabel: orgContext.org_label,
        roleKeys: orgContext.role_keys ?? [],
        platformVersion: versionInfo?.version,
      };

      await saveConnection(context, connection);
      await refreshSemanticCache(context, false);
      await refreshStatusBar(context);

      vscode.window.showInformationMessage(
        `Connected to ${connection.orgLabel ?? "your Valtren organization"}${
          connection.platformVersion ? ` on Valtren AI ${connection.platformVersion}` : ""
        }.`,
      );
    },
  );
}

async function showConnection(context: vscode.ExtensionContext) {
  const connection = await getConnection(context);
  if (!connection) {
    const action = await vscode.window.showInformationMessage(
      "Valtren AI is not connected.",
      "Connect now",
    );
    if (action === "Connect now") {
      await connectOrganization(context);
    }
    return;
  }

  const actions = [
    "Validate current extension",
    "Package current extension",
    "Upload extension ZIP",
    "Browse semantic tables",
    "Browse semantic fields",
    "Refresh semantic cache",
    "Disconnect",
  ];
  const picked = await vscode.window.showQuickPick(actions, {
    placeHolder: `${connection.orgLabel ?? "Connected org"} • ${connection.baseUrl}`,
  });

  if (!picked) {
    return;
  }

  if (picked === "Validate current extension") {
    await validateCurrentExtensionCommand();
    return;
  }
  if (picked === "Package current extension") {
    await packageCurrentExtension();
    return;
  }
  if (picked === "Upload extension ZIP") {
    await uploadExtensionZip(context);
    return;
  }
  if (picked === "Browse semantic tables") {
    await browseSemanticTables(context, false);
    return;
  }
  if (picked === "Browse semantic fields") {
    await browseSemanticFields(context, false);
    return;
  }
  if (picked === "Refresh semantic cache") {
    await refreshSemanticCache(context, true);
    return;
  }
  if (picked === "Disconnect") {
    await disconnectOrganization(context);
  }
}

async function disconnectOrganization(context: vscode.ExtensionContext) {
  await Promise.all([
    context.secrets.delete(secretKeys.apiToken),
    context.secrets.delete(secretKeys.baseUrl),
    context.secrets.delete(secretKeys.orgId),
    context.secrets.delete(secretKeys.orgLabel),
    context.secrets.delete(secretKeys.roleKeys),
    context.secrets.delete(secretKeys.platformVersion),
  ]);
  await context.globalState.update(semanticCatalogStateKey, undefined);
  await refreshStatusBar(context);
  vscode.window.showInformationMessage("Disconnected from Valtren AI.");
}

async function browseSemanticTables(context: vscode.ExtensionContext, insertIntoEditor: boolean) {
  const catalog = await getSemanticCatalog(context);
  if (!catalog) {
    return;
  }

  const selected = await vscode.window.showQuickPick(
    catalog.tables.map((table) => ({
      label: table.tableName,
      description: table.displayName || undefined,
      detail: `${table.fields.length} fields${table.description ? ` • ${table.description}` : ""}`,
      table,
    })),
    {
      placeHolder: insertIntoEditor
        ? "Select a semantic table to insert into the editor"
        : "Browse semantic tables",
      matchOnDescription: true,
      matchOnDetail: true,
    },
  );

  if (!selected) {
    return;
  }

  if (insertIntoEditor) {
    await insertTextIntoActiveEditor(selected.table.tableName);
    return;
  }

  const table = selected.table;
  const lines = [
    `Table: ${table.tableName}`,
    table.displayName ? `Label: ${table.displayName}` : undefined,
    table.description ? `Description: ${table.description}` : undefined,
    "",
    "Fields:",
    ...table.fields
      .sort((a, b) => a.fieldName.localeCompare(b.fieldName))
      .map((field) => `- ${field.fieldName}${field.fieldType ? ` (${field.fieldType})` : ""}${field.description ? ` — ${field.description}` : ""}`),
  ].filter(Boolean);

  outputChannel?.show(true);
  outputChannel?.appendLine(lines.join("\n"));
  vscode.window.showInformationMessage(`Opened semantic table ${table.tableName} in Valtren AI output.`);
}

async function browseSemanticFields(context: vscode.ExtensionContext, insertIntoEditor: boolean) {
  const catalog = await getSemanticCatalog(context);
  if (!catalog) {
    return;
  }

  const items = catalog.tables.flatMap((table) =>
    table.fields.map((field) => ({
      label: `${table.tableName}.${field.fieldName}`,
      description: field.fieldType || undefined,
      detail: field.description || table.displayName || undefined,
      value: `${table.tableName}.${field.fieldName}`,
    })),
  );

  const selected = await vscode.window.showQuickPick(items, {
    placeHolder: insertIntoEditor
      ? "Select a semantic field to insert into the editor"
      : "Browse semantic fields",
    matchOnDescription: true,
    matchOnDetail: true,
  });

  if (!selected) {
    return;
  }

  if (insertIntoEditor) {
    await insertTextIntoActiveEditor(selected.value);
    return;
  }

  outputChannel?.show(true);
  outputChannel?.appendLine(selected.value);
  vscode.window.showInformationMessage(`Copied semantic field reference to Valtren AI output.`);
}

async function refreshSemanticCache(context: vscode.ExtensionContext, noisy: boolean) {
  const connection = await getConnection(context);
  if (!connection) {
    if (noisy) {
      vscode.window.showWarningMessage("Connect to a Valtren organization first.");
    }
    return;
  }

  const overview = await postJson<SemanticOverviewResponse>(
    connection.baseUrl,
    "/api/data-semantics/overview",
    connection.apiToken,
    {},
  );

  const catalog = buildSemanticCatalog(overview);
  await context.globalState.update(semanticCatalogStateKey, catalog);
  await refreshStatusBar(context);

  if (noisy) {
    vscode.window.showInformationMessage(
      `Refreshed ${catalog.tables.length} semantic table${catalog.tables.length === 1 ? "" : "s"} from ${connection.orgLabel ?? "Valtren AI"}.`,
    );
  }
}

async function validateCurrentExtensionCommand() {
  const validation = await validateCurrentExtension();
  if (!validation) {
    return;
  }
  renderValidation(validation);
  const failed = validation.findings.filter((item) => item.status === "failed");
  if (failed.length) {
    vscode.window.showWarningMessage(
      `Validation found ${failed.length} blocking issue${failed.length === 1 ? "" : "s"}. See Valtren AI output for details.`,
    );
    return;
  }
  vscode.window.showInformationMessage(
    `Validated ${validation.suggestedName} (${validation.runtime ?? "unknown runtime"}) successfully.`,
  );
}

async function packageCurrentExtension() {
  const validation = await validateCurrentExtension();
  if (!validation) {
    return;
  }
  const failed = validation.findings.filter((item) => item.status === "failed");
  renderValidation(validation);
  if (failed.length) {
    vscode.window.showWarningMessage(
      "Cannot package this extension until the validation issues are fixed.",
    );
    return;
  }

  const zipInfo = await createExtensionZip(validation);
  outputChannel?.show(true);
  outputChannel?.appendLine(`Packaged extension ZIP: ${zipInfo.outputPath}`);
  const action = await vscode.window.showInformationMessage(
    `Packaged ${validation.suggestedName} to ${path.basename(zipInfo.outputPath)}.`,
    "Reveal in Finder",
  );
  if (action === "Reveal in Finder") {
    await vscode.commands.executeCommand("revealFileInOS", vscode.Uri.file(zipInfo.outputPath));
  }
}

async function uploadExtensionZip(context: vscode.ExtensionContext) {
  const connection = await getConnection(context);
  if (!connection) {
    const action = await vscode.window.showInformationMessage(
      "Connect to a Valtren organization before uploading an extension.",
      "Connect now",
    );
    if (action === "Connect now") {
      await connectOrganization(context);
    }
    return;
  }

  const validation = await validateCurrentExtension();
  if (!validation) {
    return;
  }
  renderValidation(validation);
  const failed = validation.findings.filter((item) => item.status === "failed");
  if (failed.length) {
    vscode.window.showWarningMessage(
      "Cannot upload this extension until the validation issues are fixed.",
    );
    return;
  }

  const displayName =
    (await vscode.window.showInputBox({
      prompt: "Extension display name override (optional)",
      value: validation.suggestedName,
      validateInput: (value) =>
        value.trim() ? undefined : "Please enter a display name or cancel.",
    })) ?? validation.suggestedName;

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: "Uploading extension to Valtren AI",
      cancellable: false,
    },
    async () => {
      const zipInfo = await createExtensionZip(validation);
      const form = new FormData();
      form.append(
        "file",
        new Blob([zipInfo.buffer], { type: "application/zip" }),
        path.basename(zipInfo.outputPath),
      );
      form.append("name", displayName.trim());

      const response = await fetch(`${connection.baseUrl}/api/admin/org/extensions/upload`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${connection.apiToken}`,
        },
        body: form,
      });

      const rawText = await response.text();
      const payload = rawText ? parseJsonSafely(rawText) : undefined;
      if (!response.ok) {
        const message =
          (payload && typeof payload === "object" && payload && "error" in payload
            ? String((payload as { error?: unknown }).error)
            : undefined) ||
          response.statusText ||
          `HTTP ${response.status}`;
        throw new Error(message);
      }

      const created =
        payload && typeof payload === "object" && payload && "created" in payload
          ? (payload as { created?: Record<string, unknown> }).created
          : undefined;
      const packageId = created && typeof created.id === "string" ? created.id : "";
      const packageStatus = created && typeof created.status === "string" ? created.status : "pending_review";

      outputChannel?.show(true);
      outputChannel?.appendLine(
        `Uploaded ${displayName.trim()} to ${connection.orgLabel ?? "Valtren AI"} (${packageId || "no package id returned"}).`,
      );

      vscode.window.showInformationMessage(
        `Uploaded ${displayName.trim()} to ${connection.orgLabel ?? "Valtren AI"} with status ${packageStatus}.`,
      );
    },
  );
}

async function getSemanticCatalog(context: vscode.ExtensionContext): Promise<SemanticCatalog | undefined> {
  let catalog = context.globalState.get<SemanticCatalog>(semanticCatalogStateKey);
  if (!catalog) {
    await refreshSemanticCache(context, false);
    catalog = context.globalState.get<SemanticCatalog>(semanticCatalogStateKey);
  }

  if (!catalog) {
    vscode.window.showWarningMessage("No semantic catalog is available yet. Connect to Valtren AI first.");
    return undefined;
  }

  return catalog;
}

async function validateCurrentExtension(): Promise<ValidationResult | undefined> {
  const rootPath = await resolveExtensionRoot();
  if (!rootPath) {
    return undefined;
  }

  const entryCandidates = [
    { runtime: "node" as const, file: "index.js" },
    { runtime: "node" as const, file: "index.mjs" },
    { runtime: "python" as const, file: "app.py" },
    { runtime: "python" as const, file: "main.py" },
  ];

  let runtime: LocalExtensionRuntime | undefined;
  let entryFile: string | undefined;
  for (const candidate of entryCandidates) {
    try {
      await fs.access(path.join(rootPath, candidate.file));
      runtime = candidate.runtime;
      entryFile = candidate.file;
      break;
    } catch {
      // continue
    }
  }

  const files = await collectExtensionFiles(rootPath);
  const findings: ValidationFinding[] = [
    {
      key: "extension_root_detected",
      status: "passed",
      detail: `Using ${rootPath} as the extension root.`,
    },
    {
      key: "zip_not_empty",
      status: files.length ? "passed" : "failed",
      detail: files.length
        ? `Found ${files.length} file${files.length === 1 ? "" : "s"} to package.`
        : "No packageable files were found in this workspace.",
    },
    {
      key: "runtime_detected",
      status: runtime ? "passed" : "failed",
      detail: runtime
        ? `Detected ${runtime} runtime from ${entryFile}.`
        : "Expected one of index.js, index.mjs, app.py, or main.py at the extension root.",
    },
    {
      key: "entry_file_present",
      status: entryFile ? "passed" : "failed",
      detail: entryFile ? `Entry file ${entryFile} is present.` : "No supported entry file was found.",
    },
    {
      key: "path_safety",
      status: "passed",
      detail: "Package builder will only include safe relative paths and will ignore common local build artifacts.",
    },
  ];

  const suggestedName = sanitizeName(path.basename(rootPath) || "valtren-extension");
  return {
    rootPath,
    runtime,
    entryFile,
    findings,
    suggestedName,
  };
}

function renderValidation(validation: ValidationResult) {
  const lines = [
    "Valtren extension validation",
    `Root: ${validation.rootPath}`,
    `Suggested name: ${validation.suggestedName}`,
    validation.runtime ? `Runtime: ${validation.runtime}` : "Runtime: not detected",
    validation.entryFile ? `Entry: ${validation.entryFile}` : "Entry: missing",
    "",
    "Findings:",
    ...validation.findings.map(
      (item) => `- [${item.status.toUpperCase()}] ${item.key}: ${item.detail}`,
    ),
    "",
  ];
  outputChannel?.show(true);
  outputChannel?.appendLine(lines.join("\n"));
}

async function resolveExtensionRoot(): Promise<string | undefined> {
  if (vscode.workspace.workspaceFolders?.length) {
    if (vscode.workspace.workspaceFolders.length === 1) {
      return vscode.workspace.workspaceFolders[0].uri.fsPath;
    }

    const selected = await vscode.window.showQuickPick(
      vscode.workspace.workspaceFolders.map((folder) => ({
        label: folder.name,
        description: folder.uri.fsPath,
        folder,
      })),
      { placeHolder: "Select the workspace folder to treat as the extension root" },
    );
    return selected?.folder.uri.fsPath;
  }

  const selected = await vscode.window.showOpenDialog({
    canSelectFiles: false,
    canSelectFolders: true,
    canSelectMany: false,
    openLabel: "Select extension root",
  });
  return selected?.[0]?.fsPath;
}

async function collectExtensionFiles(rootPath: string): Promise<string[]> {
  const results: string[] = [];

  async function walk(currentPath: string) {
    const entries = await fs.readdir(currentPath, { withFileTypes: true });
    for (const entry of entries) {
      const absolutePath = path.join(currentPath, entry.name);
      const relativePath = path.relative(rootPath, absolutePath).replace(/\\/g, "/");
      if (shouldIgnorePath(relativePath, entry.name, entry.isDirectory())) {
        continue;
      }
      if (entry.isDirectory()) {
        await walk(absolutePath);
      } else if (entry.isFile()) {
        results.push(relativePath);
      }
    }
  }

  await walk(rootPath);
  return results.sort((a, b) => a.localeCompare(b));
}

function shouldIgnorePath(relativePath: string, name: string, isDirectory: boolean): boolean {
  const normalized = String(relativePath || "").replace(/\\/g, "/");
  const topLevel = normalized.split("/")[0] || name;
  const ignoredNames = new Set([
    ".git",
    "node_modules",
    "dist",
    ".venv",
    "__pycache__",
    ".pytest_cache",
    ".mypy_cache",
    ".DS_Store",
    ".valtren",
  ]);
  if (ignoredNames.has(name) || ignoredNames.has(topLevel)) {
    return true;
  }
  if (!isDirectory && (normalized.endsWith(".vsix") || normalized.endsWith(".zip"))) {
    return true;
  }
  return false;
}

async function createExtensionZip(validation: ValidationResult): Promise<{
  outputPath: string;
  buffer: Buffer;
}> {
  const files = await collectExtensionFiles(validation.rootPath);
  const archiveEntries: Record<string, Uint8Array> = {};
  for (const relativePath of files) {
    const absolutePath = path.join(validation.rootPath, relativePath);
    const fileBuffer = await fs.readFile(absolutePath);
    archiveEntries[relativePath] = new Uint8Array(fileBuffer);
  }

  const buffer = Buffer.from(zipSync(archiveEntries, { level: 6 }));
  const outputDir = path.join(validation.rootPath, ".valtren", "dist");
  await fs.mkdir(outputDir, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outputPath = path.join(outputDir, `${validation.suggestedName}-${timestamp}.zip`);
  await fs.writeFile(outputPath, buffer);
  return { outputPath, buffer };
}

function buildSemanticCatalog(overview: SemanticOverviewResponse): SemanticCatalog {
  const tableMap = new Map<string, SemanticTable>();

  const registerTable = (tableName: string, displayName = "", description = "") => {
    const normalized = tableName.trim();
    if (!normalized) {
      return;
    }
    const existing = tableMap.get(normalized);
    if (existing) {
      if (!existing.displayName && displayName) {
        existing.displayName = displayName;
      }
      if (!existing.description && description) {
        existing.description = description;
      }
      return;
    }
    tableMap.set(normalized, {
      tableName: normalized,
      displayName,
      description,
      fields: [],
    });
  };

  for (const table of overview.canonical_tables_default ?? []) {
    registerTable(table.table_name ?? "", table.display_name ?? "", table.description ?? "");
  }
  for (const table of overview.canonical_tables_org ?? []) {
    registerTable(table.table_name ?? "", table.display_name ?? "", table.description ?? "");
  }

  for (const field of overview.semantic_fields ?? []) {
    const tableName = (field.entity_table ?? "").trim();
    const fieldName = (field.field_name ?? "").trim();
    if (!tableName || !fieldName) {
      continue;
    }
    registerTable(tableName);
    tableMap.get(tableName)?.fields.push({
      tableName,
      fieldName,
      fieldType: field.field_type ?? "",
      description: field.description ?? field.display_name ?? "",
    });
  }

  const tables = [...tableMap.values()]
    .map((table) => ({
      ...table,
      fields: [...table.fields].sort((a, b) => a.fieldName.localeCompare(b.fieldName)),
    }))
    .sort((a, b) => a.tableName.localeCompare(b.tableName));

  return {
    tables,
    refreshedAt: new Date().toISOString(),
  };
}

async function getConnection(context: vscode.ExtensionContext): Promise<ValtrenConnection | undefined> {
  const [baseUrl, apiToken] = await Promise.all([
    context.secrets.get(secretKeys.baseUrl),
    context.secrets.get(secretKeys.apiToken),
  ]);

  if (!baseUrl || !apiToken) {
    return undefined;
  }

  const [orgId, orgLabel, roleKeysRaw, platformVersion] = await Promise.all([
    context.secrets.get(secretKeys.orgId),
    context.secrets.get(secretKeys.orgLabel),
    context.secrets.get(secretKeys.roleKeys),
    context.secrets.get(secretKeys.platformVersion),
  ]);

  return {
    baseUrl,
    apiToken,
    orgId,
    orgLabel,
    roleKeys: roleKeysRaw ? JSON.parse(roleKeysRaw) : [],
    platformVersion: platformVersion ?? undefined,
  };
}

async function saveConnection(context: vscode.ExtensionContext, connection: ValtrenConnection) {
  await Promise.all([
    context.secrets.store(secretKeys.baseUrl, connection.baseUrl),
    context.secrets.store(secretKeys.apiToken, connection.apiToken),
    context.secrets.store(secretKeys.orgId, connection.orgId ?? ""),
    context.secrets.store(secretKeys.orgLabel, connection.orgLabel ?? ""),
    context.secrets.store(secretKeys.roleKeys, JSON.stringify(connection.roleKeys)),
    context.secrets.store(secretKeys.platformVersion, connection.platformVersion ?? ""),
  ]);
}

async function refreshStatusBar(context: vscode.ExtensionContext) {
  if (!statusBarItem) {
    return;
  }

  const connection = await getConnection(context);
  if (!connection) {
    statusBarItem.text = "$(plug) Valtren: Not connected";
    statusBarItem.tooltip = "Connect this workspace to a Valtren organization.";
    statusBarItem.show();
    return;
  }

  statusBarItem.text = `$(plug) Valtren: ${connection.orgLabel ?? "Connected"}`;
  statusBarItem.tooltip = [
    connection.baseUrl,
    connection.platformVersion ? `Version ${connection.platformVersion}` : undefined,
    connection.roleKeys.length ? `Roles: ${connection.roleKeys.join(", ")}` : undefined,
  ]
    .filter(Boolean)
    .join("\n");
  statusBarItem.show();
}

async function insertTextIntoActiveEditor(value: string) {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showWarningMessage("Open a file first to insert a semantic reference.");
    return;
  }

  await editor.edit((editBuilder) => {
    editBuilder.replace(editor.selection, value);
  });
}

async function postJson<T>(
  baseUrl: string,
  route: string,
  apiToken: string,
  body: unknown,
): Promise<T> {
  const response = await fetch(`${baseUrl}${route}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiToken}`,
    },
    body: JSON.stringify(body),
  });

  const rawText = await response.text();
  const payload = rawText ? parseJsonSafely(rawText) : undefined;

  if (!response.ok) {
    const message =
      (payload && typeof payload === "object" && payload && "error" in payload
        ? String((payload as { error?: unknown }).error)
        : undefined) ||
      response.statusText ||
      `HTTP ${response.status}`;
    throw new Error(message);
  }

  return (payload ?? {}) as T;
}

async function safePostJson<T>(
  baseUrl: string,
  route: string,
  apiToken: string,
  body: unknown,
): Promise<T | undefined> {
  try {
    return await postJson<T>(baseUrl, route, apiToken, body);
  } catch {
    return undefined;
  }
}

function parseJsonSafely(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return { raw };
  }
}

function normalizeBaseUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error("Base URL is required.");
  }
  const url = new URL(trimmed);
  return url.origin.replace(/\/$/, "");
}

function sanitizeName(value: string): string {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-_]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "") || "valtren-extension";
}

function shellEscape(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}
