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

type OrgExtensionPackage = {
  id: string;
  extension_key?: string;
  display_name?: string;
  version?: string;
  status?: string;
  source_type?: string;
  entry_file?: string;
  manifest?: {
    runtime?: string;
    smoke_test_route?: string | null;
  };
  installation?: {
    enabled?: boolean;
    runtime_status?: string;
    health_status?: string;
    runtime_metadata?: {
      smoke_test_route?: string | null;
    };
  } | null;
};

type OrgExtensionsListResponse = {
  org_id?: string;
  package_count?: number;
  enabled_count?: number;
  pending_review_count?: number;
  failed_count?: number;
  packages?: OrgExtensionPackage[];
};

type OrgExtensionTestResponse = {
  ok?: boolean;
  status_code?: number;
  route?: string | null;
  body?: unknown;
};

type OrgExtensionSourceResponse = {
  extension_key?: string;
  display_name?: string;
  runtime?: string;
  entry_file?: string | null;
  smoke_test_route?: string | null;
  source_type?: string;
  github_url?: string | null;
  github_ref?: string | null;
  github_subdirectory?: string | null;
  files?: string[];
  selected_file?: string | null;
  content?: string | null;
  content_truncated?: boolean;
  content_message?: string | null;
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
let connectionViewProvider: ConnectionTreeProvider | undefined;
let semanticsViewProvider: SemanticsTreeProvider | undefined;
let extensionsViewProvider: ExtensionsTreeProvider | undefined;
const semanticDocumentSelector: vscode.DocumentSelector = [
  { language: "javascript" },
  { language: "typescript" },
  { language: "python" },
  { language: "java" },
  { language: "csharp" },
  { language: "json" },
  { language: "yaml" },
  { language: "plaintext" },
  { language: "markdown" },
];

type ConnectionTreeNode =
  | { kind: "connect" }
  | { kind: "disconnect" }
  | { kind: "refreshSemantics" }
  | { kind: "showConnection" }
  | { kind: "connected"; label: string; description?: string }
  | { kind: "version"; label: string };

type SemanticsTreeNode =
  | { kind: "empty"; label: string }
  | { kind: "table"; table: SemanticTable }
  | { kind: "field"; field: SemanticField };

type ExtensionTreeNode =
  | { kind: "empty"; label: string }
  | { kind: "package"; pkg: OrgExtensionPackage }
  | { kind: "packageAction"; action: "test" | "source" | "approve" | "enable" | "disable"; pkg: OrgExtensionPackage };

class ConnectionTreeProvider implements vscode.TreeDataProvider<ConnectionTreeNode> {
  private readonly emitter = new vscode.EventEmitter<ConnectionTreeNode | undefined | null | void>();
  readonly onDidChangeTreeData = this.emitter.event;

  constructor(private readonly context: vscode.ExtensionContext) {}

  refresh() {
    this.emitter.fire();
  }

  getTreeItem(element: ConnectionTreeNode): vscode.TreeItem {
    if (element.kind === "connected") {
      const item = new vscode.TreeItem(element.label, vscode.TreeItemCollapsibleState.None);
      item.description = element.description;
      item.iconPath = new vscode.ThemeIcon("plug");
      item.command = { command: "valtren.showConnection", title: "Show Connected Organization" };
      return item;
    }
    if (element.kind === "version") {
      const item = new vscode.TreeItem(element.label, vscode.TreeItemCollapsibleState.None);
      item.iconPath = new vscode.ThemeIcon("versions");
      return item;
    }
    const labelMap: Record<ConnectionTreeNode["kind"], string> = {
      connect: "Connect to Organization",
      disconnect: "Disconnect from Organization",
      refreshSemantics: "Refresh Semantic Cache",
      showConnection: "Show Connected Organization",
      connected: "",
      version: "",
    };
    const commandMap: Partial<Record<ConnectionTreeNode["kind"], string>> = {
      connect: "valtren.connectOrganization",
      disconnect: "valtren.disconnectOrganization",
      refreshSemantics: "valtren.refreshSemanticCache",
      showConnection: "valtren.showConnection",
    };
    const iconMap: Partial<Record<ConnectionTreeNode["kind"], string>> = {
      connect: "plug",
      disconnect: "debug-disconnect",
      refreshSemantics: "refresh",
      showConnection: "info",
    };
    const item = new vscode.TreeItem(labelMap[element.kind], vscode.TreeItemCollapsibleState.None);
    item.iconPath = new vscode.ThemeIcon(iconMap[element.kind] || "circle");
    const command = commandMap[element.kind];
    if (command) {
      item.command = { command, title: labelMap[element.kind] };
    }
    return item;
  }

  async getChildren(element?: ConnectionTreeNode): Promise<ConnectionTreeNode[]> {
    if (element) {
      return [];
    }
    const connection = await getConnection(this.context);
    if (!connection) {
      return [{ kind: "connect" }];
    }
    return [
      {
        kind: "connected",
        label: connection.orgLabel || "Connected organization",
        description: connection.baseUrl,
      },
      ...(connection.platformVersion
        ? ([{ kind: "version", label: `Valtren AI ${connection.platformVersion}` }] as ConnectionTreeNode[])
        : []),
      { kind: "showConnection" } as ConnectionTreeNode,
      { kind: "refreshSemantics" } as ConnectionTreeNode,
      { kind: "disconnect" } as ConnectionTreeNode,
    ];
  }
}

class SemanticsTreeProvider implements vscode.TreeDataProvider<SemanticsTreeNode> {
  private readonly emitter = new vscode.EventEmitter<SemanticsTreeNode | undefined | null | void>();
  readonly onDidChangeTreeData = this.emitter.event;

  constructor(private readonly context: vscode.ExtensionContext) {}

  refresh() {
    this.emitter.fire();
  }

  getTreeItem(element: SemanticsTreeNode): vscode.TreeItem {
    if (element.kind === "empty") {
      const item = new vscode.TreeItem(element.label, vscode.TreeItemCollapsibleState.None);
      item.iconPath = new vscode.ThemeIcon("info");
      return item;
    }
    if (element.kind === "table") {
      const item = new vscode.TreeItem(
        element.table.tableName,
        vscode.TreeItemCollapsibleState.Collapsed,
      );
      item.description = element.table.displayName || undefined;
      item.tooltip = element.table.description || element.table.tableName;
      item.iconPath = new vscode.ThemeIcon("database");
      item.command = {
        command: "valtren.insertSemanticTable",
        title: "Insert Semantic Table",
        arguments: [element.table.tableName],
      };
      return item;
    }
    const item = new vscode.TreeItem(
      `${element.field.fieldName}${element.field.fieldType ? ` (${element.field.fieldType})` : ""}`,
      vscode.TreeItemCollapsibleState.None,
    );
    item.description = element.field.description || undefined;
    item.tooltip = `${element.field.tableName}.${element.field.fieldName}${
      element.field.description ? `\n${element.field.description}` : ""
    }`;
    item.iconPath = new vscode.ThemeIcon("symbol-field");
    item.command = {
      command: "valtren.insertSemanticField",
      title: "Insert Semantic Field",
      arguments: [`${element.field.tableName}.${element.field.fieldName}`],
    };
    return item;
  }

  async getChildren(element?: SemanticsTreeNode): Promise<SemanticsTreeNode[]> {
    const catalog = this.context.globalState.get<SemanticCatalog>(semanticCatalogStateKey);
    if (!catalog) {
      return !element ? [{ kind: "empty", label: "Connect and refresh semantics to browse tables" }] : [];
    }
    if (!element) {
      return catalog.tables.map((table) => ({ kind: "table", table }));
    }
    if (element.kind === "table") {
      return element.table.fields.map((field) => ({ kind: "field", field }));
    }
    return [];
  }
}

class ExtensionsTreeProvider implements vscode.TreeDataProvider<ExtensionTreeNode> {
  private readonly emitter = new vscode.EventEmitter<ExtensionTreeNode | undefined | null | void>();
  readonly onDidChangeTreeData = this.emitter.event;

  constructor(private readonly context: vscode.ExtensionContext) {}

  refresh() {
    this.emitter.fire();
  }

  getTreeItem(element: ExtensionTreeNode): vscode.TreeItem {
    if (element.kind === "empty") {
      const item = new vscode.TreeItem(element.label, vscode.TreeItemCollapsibleState.None);
      item.iconPath = new vscode.ThemeIcon("info");
      return item;
    }
    if (element.kind === "package") {
      const item = new vscode.TreeItem(
        element.pkg.display_name || element.pkg.extension_key || element.pkg.id,
        vscode.TreeItemCollapsibleState.Collapsed,
      );
      item.description = `${element.pkg.status || "unknown"}${element.pkg.installation?.enabled ? " • enabled" : ""}`;
      item.tooltip =
        element.pkg.installation?.runtime_metadata?.smoke_test_route ||
        element.pkg.manifest?.smoke_test_route ||
        element.pkg.entry_file ||
        element.pkg.source_type ||
        "";
      item.iconPath = new vscode.ThemeIcon(element.pkg.installation?.enabled ? "package" : "archive");
      return item;
    }
    const titleMap = {
      test: "Test extension",
      source: "Browse source",
      approve: "Approve",
      enable: "Enable",
      disable: "Disable",
    };
    const commandMap = {
      test: "valtren.testUploadedExtension",
      source: "valtren.browseUploadedExtensionSource",
      approve: "valtren.approveUploadedExtension",
      enable: "valtren.enableUploadedExtension",
      disable: "valtren.disableUploadedExtension",
    };
    const iconMap = {
      test: "beaker",
      source: "file-code",
      approve: "pass",
      enable: "play",
      disable: "circle-slash",
    };
    const item = new vscode.TreeItem(titleMap[element.action], vscode.TreeItemCollapsibleState.None);
    item.iconPath = new vscode.ThemeIcon(iconMap[element.action]);
    item.command = {
      command: commandMap[element.action],
      title: titleMap[element.action],
      arguments: [element.pkg],
    };
    return item;
  }

  async getChildren(element?: ExtensionTreeNode): Promise<ExtensionTreeNode[]> {
    const connection = await getConnection(this.context);
    if (!connection) {
      return !element ? [{ kind: "empty", label: "Connect to Valtren AI to manage uploaded extensions" }] : [];
    }
    if (!element) {
      const payload = await fetchOrgExtensions(connection).catch(() => undefined);
      const packages = Array.isArray(payload?.packages) ? payload?.packages : [];
      if (!packages.length) {
        return [{ kind: "empty", label: "No uploaded extensions found in this organization" }];
      }
      return packages.map((pkg) => ({ kind: "package", pkg }));
    }
    if (element.kind === "package") {
      const actions: ExtensionTreeNode[] = [
        { kind: "packageAction", action: "source", pkg: element.pkg },
      ];
      if (element.pkg.installation?.enabled) {
        actions.push({ kind: "packageAction", action: "test", pkg: element.pkg });
        actions.push({ kind: "packageAction", action: "disable", pkg: element.pkg });
      } else {
        if (element.pkg.status === "pending_review") {
          actions.push({ kind: "packageAction", action: "approve", pkg: element.pkg });
        }
        if (element.pkg.status === "approved" || element.pkg.status === "disabled" || element.pkg.status === "enabled") {
          actions.push({ kind: "packageAction", action: "enable", pkg: element.pkg });
        }
      }
      return actions;
    }
    return [];
  }
}

export function activate(context: vscode.ExtensionContext) {
  outputChannel = vscode.window.createOutputChannel(outputChannelName);
  context.subscriptions.push(outputChannel);

  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  statusBarItem.command = "valtren.showConnection";
  context.subscriptions.push(statusBarItem);

  connectionViewProvider = new ConnectionTreeProvider(context);
  semanticsViewProvider = new SemanticsTreeProvider(context);
  extensionsViewProvider = new ExtensionsTreeProvider(context);
  context.subscriptions.push(
    vscode.window.registerTreeDataProvider("valtrenConnection", connectionViewProvider),
  );
  context.subscriptions.push(
    vscode.window.registerTreeDataProvider("valtrenSemantics", semanticsViewProvider),
  );
  context.subscriptions.push(
    vscode.window.registerTreeDataProvider("valtrenUploadedExtensions", extensionsViewProvider),
  );
  context.subscriptions.push(
    vscode.languages.registerCompletionItemProvider(
      semanticDocumentSelector,
      createSemanticCompletionProvider(context),
      ".",
    ),
  );
  context.subscriptions.push(
    vscode.languages.registerHoverProvider(
      semanticDocumentSelector,
      createSemanticHoverProvider(context),
    ),
  );

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

  register("valtren.listUploadedExtensions", async () => {
    await listUploadedExtensions(context);
  });

  register("valtren.testUploadedExtension", async () => {
    await testUploadedExtension(context);
  });

  register("valtren.browseUploadedExtensionSource", async (pkg?: unknown) => {
    await browseUploadedExtensionSource(context, isOrgExtensionPackage(pkg) ? pkg : undefined);
  });

  register("valtren.approveUploadedExtension", async (pkg?: unknown) => {
    await reviewUploadedExtension(context, "approve", isOrgExtensionPackage(pkg) ? pkg : undefined);
  });

  register("valtren.enableUploadedExtension", async (pkg?: unknown) => {
    await changeUploadedExtensionState(context, "enable", isOrgExtensionPackage(pkg) ? pkg : undefined);
  });

  register("valtren.disableUploadedExtension", async (pkg?: unknown) => {
    await changeUploadedExtensionState(context, "disable", isOrgExtensionPackage(pkg) ? pkg : undefined);
  });

  register("valtren.browseSemanticTables", async () => {
    await browseSemanticTables(context, false);
  });

  register("valtren.browseSemanticFields", async () => {
    await browseSemanticFields(context, false);
  });

  register("valtren.insertSemanticTable", async (tableName?: unknown) => {
    await browseSemanticTables(context, true, typeof tableName === "string" ? tableName : undefined);
  });

  register("valtren.insertSemanticField", async (fieldRef?: unknown) => {
    await browseSemanticFields(context, true, typeof fieldRef === "string" ? fieldRef : undefined);
  });

  void refreshStatusBar(context);
  refreshWorkbenchViews();
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
      refreshWorkbenchViews();

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
    "List uploaded extensions",
    "Test uploaded extension",
    "Browse uploaded extension source",
    "Approve uploaded extension",
    "Enable uploaded extension",
    "Disable uploaded extension",
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
  if (picked === "List uploaded extensions") {
    await listUploadedExtensions(context);
    return;
  }
  if (picked === "Test uploaded extension") {
    await testUploadedExtension(context);
    return;
  }
  if (picked === "Browse uploaded extension source") {
    await browseUploadedExtensionSource(context);
    return;
  }
  if (picked === "Approve uploaded extension") {
    await reviewUploadedExtension(context, "approve");
    return;
  }
  if (picked === "Enable uploaded extension") {
    await changeUploadedExtensionState(context, "enable");
    return;
  }
  if (picked === "Disable uploaded extension") {
    await changeUploadedExtensionState(context, "disable");
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
  refreshWorkbenchViews();
  vscode.window.showInformationMessage("Disconnected from Valtren AI.");
}

async function browseSemanticTables(
  context: vscode.ExtensionContext,
  insertIntoEditor: boolean,
  initialTableName?: string,
) {
  const catalog = await getSemanticCatalog(context);
  if (!catalog) {
    return;
  }

  if (insertIntoEditor && initialTableName) {
    await insertTextIntoActiveEditor(initialTableName);
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

async function browseSemanticFields(
  context: vscode.ExtensionContext,
  insertIntoEditor: boolean,
  initialFieldRef?: string,
) {
  const catalog = await getSemanticCatalog(context);
  if (!catalog) {
    return;
  }

  if (insertIntoEditor && initialFieldRef) {
    await insertTextIntoActiveEditor(initialFieldRef);
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
  refreshWorkbenchViews();

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
      refreshWorkbenchViews();
    },
  );
}

async function listUploadedExtensions(context: vscode.ExtensionContext) {
  const connection = await getConnection(context);
  if (!connection) {
    const action = await vscode.window.showInformationMessage(
      "Connect to a Valtren organization before listing uploaded extensions.",
      "Connect now",
    );
    if (action === "Connect now") {
      await connectOrganization(context);
    }
    return;
  }

  const payload = await requestJson<OrgExtensionsListResponse>(
    connection.baseUrl,
    "/api/admin/org/extensions/packages",
    connection.apiToken,
    { method: "GET" },
  );
  const packages = Array.isArray(payload.packages) ? payload.packages : [];

  if (!packages.length) {
    vscode.window.showInformationMessage(
      `No uploaded org extensions were found in ${connection.orgLabel ?? "Valtren AI"}.`,
    );
    return;
  }

  outputChannel?.show(true);
  outputChannel?.appendLine(
    [
      `Uploaded extensions for ${connection.orgLabel ?? "Valtren AI"}`,
      `Total: ${payload.package_count ?? packages.length}`,
      `Enabled: ${payload.enabled_count ?? packages.filter((item) => item.installation?.enabled).length}`,
      "",
      ...packages.map((pkg) => {
        const smokeRoute =
          pkg.installation?.runtime_metadata?.smoke_test_route ||
          pkg.manifest?.smoke_test_route ||
          null;
        return `- ${pkg.display_name || pkg.extension_key || pkg.id} (${pkg.version || "1.0.0"}) • ${pkg.status || "unknown"} • ${
          pkg.installation?.enabled ? "enabled" : "not enabled"
        }${smokeRoute ? ` • smoke ${smokeRoute}` : ""}`;
      }),
      "",
    ].join("\n"),
  );

  await vscode.window.showQuickPick(
    packages.map((pkg) => ({
      label: pkg.display_name || pkg.extension_key || pkg.id,
      description: `${pkg.status || "unknown"}${pkg.installation?.enabled ? " • enabled" : ""}`,
      detail:
        pkg.installation?.runtime_metadata?.smoke_test_route ||
        pkg.manifest?.smoke_test_route ||
        pkg.entry_file ||
        pkg.source_type ||
        undefined,
    })),
    {
      placeHolder: "Uploaded extension summary was written to the Valtren AI output channel",
    },
  );
}

async function testUploadedExtension(context: vscode.ExtensionContext, selectedPkg?: OrgExtensionPackage) {
  let selection: { connection: ValtrenConnection; pkg: OrgExtensionPackage } | undefined;
  if (selectedPkg) {
    const connection = await getConnection(context);
    if (!connection) {
      const action = await vscode.window.showInformationMessage(
        "Connect to a Valtren organization before testing an uploaded extension.",
        "Connect now",
      );
      if (action === "Connect now") {
        await connectOrganization(context);
      }
      return;
    }
    selection = { connection, pkg: selectedPkg };
  } else {
    selection = await pickUploadedExtension(
      context,
      "Select an enabled uploaded extension to smoke-test",
      (pkg) => Boolean(pkg.installation?.enabled),
    );
  }
  if (!selection) {
    return;
  }
  const label = selection.pkg.display_name || selection.pkg.extension_key || selection.pkg.id;

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: `Testing ${label}`,
      cancellable: false,
    },
    async () => {
      const result = await requestJson<OrgExtensionTestResponse>(
        selection.connection.baseUrl,
        `/api/admin/org/extensions/${selection.pkg.id}/test`,
        selection.connection.apiToken,
        { method: "POST", body: {} },
      );

      outputChannel?.show(true);
      outputChannel?.appendLine(
        [
          `Extension smoke test: ${label}`,
          `Status: ${result.status_code ?? (result.ok ? 200 : 400)}`,
          result.route ? `Route: ${result.route}` : undefined,
          "Response:",
          formatJson(result.body ?? result),
          "",
        ]
          .filter(Boolean)
          .join("\n"),
      );

      if (result.ok) {
        vscode.window.showInformationMessage(
          `${label} passed smoke test${result.route ? ` via ${result.route}` : ""}.`,
        );
        return;
      }

      const message =
        result && typeof result.body === "object" && result.body && "error" in (result.body as Record<string, unknown>)
          ? String((result.body as Record<string, unknown>).error)
          : "Smoke test failed";
      vscode.window.showWarningMessage(`${label}: ${message}`);
    },
  );
}

async function browseUploadedExtensionSource(context: vscode.ExtensionContext, selectedPkg?: OrgExtensionPackage) {
  const selection =
    selectedPkg && (await getConnection(context))
      ? { connection: (await getConnection(context))!, pkg: selectedPkg }
      : await pickUploadedExtension(context, "Select an uploaded extension to browse");
  if (!selection) {
    return;
  }

  let preview = await requestJson<OrgExtensionSourceResponse>(
    selection.connection.baseUrl,
    `/api/admin/org/extensions/${selection.pkg.id}/source`,
    selection.connection.apiToken,
    { method: "POST", body: {} },
  );

  const files = Array.isArray(preview.files) ? preview.files : [];
  if (!files.length) {
    vscode.window.showInformationMessage("This uploaded extension does not expose any previewable files.");
    return;
  }

  while (true) {
    const picked = await vscode.window.showQuickPick(
      files.map((file) => ({
        label: file,
        description: file === preview.selected_file ? "selected" : undefined,
      })),
      {
        placeHolder: `${preview.display_name || selection.pkg.display_name || selection.pkg.extension_key || selection.pkg.id} source files`,
        matchOnDescription: true,
      },
    );
    if (!picked) {
      return;
    }

    preview = await requestJson<OrgExtensionSourceResponse>(
      selection.connection.baseUrl,
      `/api/admin/org/extensions/${selection.pkg.id}/source`,
      selection.connection.apiToken,
      { method: "POST", body: { file_path: picked.label } },
    );

    const previewContent = [
      `// Uploaded extension source: ${preview.display_name || selection.pkg.display_name || selection.pkg.extension_key || selection.pkg.id}`,
      `// Runtime: ${preview.runtime || "unknown"}`,
      preview.entry_file ? `// Entry: ${preview.entry_file}` : undefined,
      preview.smoke_test_route ? `// Smoke route: ${preview.smoke_test_route}` : undefined,
      preview.github_url ? `// GitHub: ${preview.github_url}${preview.github_ref ? ` @ ${preview.github_ref}` : ""}` : undefined,
      preview.content_message ? `// ${preview.content_message}` : undefined,
      "",
      preview.content || "(No preview available for this file)",
    ]
      .filter(Boolean)
      .join("\n");
    const language = inferLanguageFromPath(preview.selected_file || picked.label);
    const doc = await vscode.workspace.openTextDocument({
      content: previewContent,
      language,
    });
    await vscode.window.showTextDocument(doc, { preview: false });

    const action = await vscode.window.showInformationMessage(
      `Opened ${preview.selected_file || picked.label}.`,
      "Browse another file",
    );
    if (action !== "Browse another file") {
      return;
    }
  }
}

async function reviewUploadedExtension(
  context: vscode.ExtensionContext,
  decision: "approve",
  selectedPkg?: OrgExtensionPackage,
) {
  const connection = selectedPkg ? await getConnection(context) : undefined;
  const selection =
    selectedPkg && connection
      ? { connection, pkg: selectedPkg }
      : await pickUploadedExtension(
          context,
          decision === "approve" ? "Select a pending uploaded extension to approve" : "Select uploaded extension",
          (pkg) => (decision === "approve" ? pkg.status === "pending_review" : true),
        );
  if (!selection) {
    return;
  }

  const result = await requestJson<{ package?: OrgExtensionPackage }>(
    selection.connection.baseUrl,
    `/api/admin/org/extensions/${selection.pkg.id}/review`,
    selection.connection.apiToken,
    { method: "POST", body: { decision } },
  );

  const label = selection.pkg.display_name || selection.pkg.extension_key || selection.pkg.id;
  outputChannel?.show(true);
  outputChannel?.appendLine(`${label}: review decision ${decision} applied.`);
  vscode.window.showInformationMessage(
    `${label} marked as ${(result.package?.status || "approved").replace(/_/g, " ")}.`,
  );
  refreshWorkbenchViews();
}

async function changeUploadedExtensionState(
  context: vscode.ExtensionContext,
  action: "enable" | "disable",
  selectedPkg?: OrgExtensionPackage,
) {
  const connection = selectedPkg ? await getConnection(context) : undefined;
  const selection =
    selectedPkg && connection
      ? { connection, pkg: selectedPkg }
      : await pickUploadedExtension(
          context,
          action === "enable"
            ? "Select an uploaded extension to enable"
            : "Select an uploaded extension to disable",
          (pkg) => {
            if (action === "enable") {
              return pkg.status === "approved" || pkg.status === "disabled" || pkg.status === "enabled";
            }
            return Boolean(pkg.installation?.enabled);
          },
        );
  if (!selection) {
    return;
  }

  const result = await requestJson<{
    package?: OrgExtensionPackage;
    installation?: OrgExtensionPackage["installation"];
    message?: string;
  }>(
    selection.connection.baseUrl,
    `/api/admin/org/extensions/${selection.pkg.id}/${action}`,
    selection.connection.apiToken,
    { method: "POST", body: {} },
  );

  const label = selection.pkg.display_name || selection.pkg.extension_key || selection.pkg.id;
  const runtimeStatus = result.installation?.runtime_status || "unknown";
  outputChannel?.show(true);
  outputChannel?.appendLine(
    `${label}: ${action} completed (${runtimeStatus})${result.message ? ` — ${result.message}` : ""}`,
  );
  vscode.window.showInformationMessage(
    `${label} ${action}d with runtime status ${runtimeStatus}.`,
  );
  refreshWorkbenchViews();
}

async function fetchOrgExtensions(connection: ValtrenConnection): Promise<OrgExtensionsListResponse> {
  return requestJson<OrgExtensionsListResponse>(
    connection.baseUrl,
    "/api/admin/org/extensions/packages",
    connection.apiToken,
    { method: "GET" },
  );
}

async function pickUploadedExtension(
  context: vscode.ExtensionContext,
  placeHolder: string,
  predicate: (pkg: OrgExtensionPackage) => boolean = () => true,
): Promise<{ connection: ValtrenConnection; pkg: OrgExtensionPackage } | undefined> {
  const connection = await getConnection(context);
  if (!connection) {
    const action = await vscode.window.showInformationMessage(
      "Connect to a Valtren organization first.",
      "Connect now",
    );
    if (action === "Connect now") {
      await connectOrganization(context);
    }
    return undefined;
  }

  const payload = await requestJson<OrgExtensionsListResponse>(
    connection.baseUrl,
    "/api/admin/org/extensions/packages",
    connection.apiToken,
    { method: "GET" },
  );
  const packages = (Array.isArray(payload.packages) ? payload.packages : []).filter(predicate);

  if (!packages.length) {
    vscode.window.showInformationMessage(
      `No matching uploaded extensions were found in ${connection.orgLabel ?? "Valtren AI"}.`,
    );
    return undefined;
  }

  const selected = await vscode.window.showQuickPick(
    packages.map((pkg) => ({
      label: pkg.display_name || pkg.extension_key || pkg.id,
      description: `${pkg.status || "unknown"}${pkg.installation?.enabled ? " • enabled" : ""}`,
      detail:
        pkg.installation?.runtime_metadata?.smoke_test_route ||
        pkg.manifest?.smoke_test_route ||
        pkg.entry_file ||
        pkg.source_type ||
        undefined,
      pkg,
    })),
    {
      placeHolder,
      matchOnDescription: true,
      matchOnDetail: true,
    },
  );

  if (!selected) {
    return undefined;
  }

  return { connection, pkg: selected.pkg };
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

function refreshWorkbenchViews() {
  connectionViewProvider?.refresh();
  semanticsViewProvider?.refresh();
  extensionsViewProvider?.refresh();
}

function createSemanticCompletionProvider(
  context: vscode.ExtensionContext,
): vscode.CompletionItemProvider {
  return {
    provideCompletionItems(document, position) {
      const catalog = context.globalState.get<SemanticCatalog>(semanticCatalogStateKey);
      if (!catalog?.tables?.length) {
        return [];
      }

      const linePrefix = document.lineAt(position).text.slice(0, position.character);
      const tokenMatch = linePrefix.match(/([A-Za-z0-9_]+(?:\.[A-Za-z0-9_]*)?)$/);
      const token = tokenMatch?.[1] ?? "";

      if (token.includes(".")) {
        const [tableName, partialField = ""] = token.split(".", 2);
        const table = catalog.tables.find((item) => item.tableName === tableName);
        if (!table) {
          return [];
        }
        return table.fields
          .filter((field) => !partialField || field.fieldName.startsWith(partialField))
          .map((field) => {
            const item = new vscode.CompletionItem(field.fieldName, vscode.CompletionItemKind.Field);
            item.insertText = field.fieldName;
            item.detail = `${field.tableName}.${field.fieldName}${field.fieldType ? ` • ${field.fieldType}` : ""}`;
            item.documentation = buildSemanticFieldMarkdown(field);
            item.sortText = `1-${field.fieldName}`;
            return item;
          });
      }

      return catalog.tables
        .filter((table) => !token || table.tableName.startsWith(token))
        .map((table) => {
          const item = new vscode.CompletionItem(table.tableName, vscode.CompletionItemKind.Struct);
          item.insertText = table.tableName;
          item.detail = table.displayName || "Semantic table";
          item.documentation = buildSemanticTableMarkdown(table);
          item.sortText = `0-${table.tableName}`;
          return item;
        });
    },
  };
}

function createSemanticHoverProvider(context: vscode.ExtensionContext): vscode.HoverProvider {
  return {
    provideHover(document, position) {
      const catalog = context.globalState.get<SemanticCatalog>(semanticCatalogStateKey);
      if (!catalog?.tables?.length) {
        return undefined;
      }

      const range = document.getWordRangeAtPosition(position, /[A-Za-z0-9_.]+/);
      if (!range) {
        return undefined;
      }
      const value = document.getText(range);
      if (!value) {
        return undefined;
      }

      if (value.includes(".")) {
        const [tableName, fieldName] = value.split(".", 2);
        const table = catalog.tables.find((item) => item.tableName === tableName);
        const field = table?.fields.find((item) => item.fieldName === fieldName);
        if (!field) {
          return undefined;
        }
        return new vscode.Hover(buildSemanticFieldMarkdown(field), range);
      }

      const table = catalog.tables.find((item) => item.tableName === value);
      if (!table) {
        return undefined;
      }
      return new vscode.Hover(buildSemanticTableMarkdown(table), range);
    },
  };
}

function isOrgExtensionPackage(value: unknown): value is OrgExtensionPackage {
  return Boolean(
    value &&
      typeof value === "object" &&
      "id" in value &&
      typeof (value as { id?: unknown }).id === "string",
  );
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

function inferLanguageFromPath(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".js" || ext === ".mjs" || ext === ".cjs") return "javascript";
  if (ext === ".ts" || ext === ".mts" || ext === ".cts") return "typescript";
  if (ext === ".py") return "python";
  if (ext === ".java") return "java";
  if (ext === ".cs") return "csharp";
  if (ext === ".json") return "json";
  if (ext === ".md") return "markdown";
  if (ext === ".yml" || ext === ".yaml") return "yaml";
  if (ext === ".xml") return "xml";
  return "plaintext";
}

function buildSemanticTableMarkdown(table: SemanticTable): vscode.MarkdownString {
  const markdown = new vscode.MarkdownString(undefined, true);
  markdown.appendMarkdown(`**${table.tableName}**`);
  if (table.displayName) {
    markdown.appendMarkdown(`\n\n${table.displayName}`);
  }
  if (table.description) {
    markdown.appendMarkdown(`\n\n${table.description}`);
  }
  markdown.appendMarkdown(`\n\nFields: ${table.fields.length}`);
  const previewFields = table.fields.slice(0, 8).map((field) => `\`${field.fieldName}\``);
  if (previewFields.length) {
    markdown.appendMarkdown(`\n\n${previewFields.join(", ")}`);
    if (table.fields.length > previewFields.length) {
      markdown.appendMarkdown(`, and ${table.fields.length - previewFields.length} more`);
    }
  }
  markdown.isTrusted = false;
  return markdown;
}

function buildSemanticFieldMarkdown(field: SemanticField): vscode.MarkdownString {
  const markdown = new vscode.MarkdownString(undefined, true);
  markdown.appendMarkdown(`**${field.tableName}.${field.fieldName}**`);
  if (field.fieldType) {
    markdown.appendMarkdown(`\n\nType: \`${field.fieldType}\``);
  }
  if (field.description) {
    markdown.appendMarkdown(`\n\n${field.description}`);
  }
  markdown.isTrusted = false;
  return markdown;
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
  return requestJson<T>(baseUrl, route, apiToken, {
    method: "POST",
    body,
  });
}

async function requestJson<T>(
  baseUrl: string,
  route: string,
  apiToken: string,
  options: {
    method?: "GET" | "POST";
    body?: unknown;
  } = {},
): Promise<T> {
  const method = options.method ?? "POST";
  const headers: Record<string, string> = {
    authorization: `Bearer ${apiToken}`,
  };
  if (method !== "GET") {
    headers["content-type"] = "application/json";
  }
  const response = await fetch(`${baseUrl}${route}`, {
    method,
    headers,
    body: method === "GET" ? undefined : JSON.stringify(options.body ?? {}),
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

function formatJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value ?? "");
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
