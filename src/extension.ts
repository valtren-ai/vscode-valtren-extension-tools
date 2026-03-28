import * as vscode from 'vscode';

export function activate(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.commands.registerCommand('valtren.createExtension', async () => {
      const name = await vscode.window.showInputBox({
        prompt: 'Extension name',
        placeHolder: 'my-extension',
      });
      if (!name) return;

      const runtime = await vscode.window.showQuickPick(
        [
          { label: 'node-pack', detail: 'In-process Node workflow, catalog, and executor pack' },
          { label: 'org-zip-node', detail: 'Customer-owned Node ZIP for Org Settings upload' },
          { label: 'org-zip-python', detail: 'Customer-owned Python ZIP for Org Settings upload' },
          { label: 'sidecar-python', detail: 'Python sidecar for health, hooks, and domain APIs' },
          { label: 'sidecar-java', detail: 'Spring Boot sidecar for Java teams' },
          { label: 'sidecar-dotnet', detail: 'ASP.NET Core sidecar for .NET teams' },
        ],
        { placeHolder: 'Choose a runtime template' }
      );
      if (!runtime) return;

      const folder = await vscode.window.showOpenDialog({
        canSelectFolders: true,
        canSelectFiles: false,
        canSelectMany: false,
        openLabel: 'Choose output folder',
      });
      if (!folder?.[0]) return;

      const terminal = vscode.window.createTerminal('Valtren Extension Tools');
      terminal.show();
      const outDir = `${folder[0].fsPath}/${name}`;
      terminal.sendText(`npx create-valtren-extension ${name} --runtime ${runtime.label} --dir "${outDir}"`);
    }),
    vscode.commands.registerCommand('valtren.openExamples', async () => {
      await vscode.env.openExternal(vscode.Uri.parse('https://github.com/valtren-ai/extension-examples'));
    })
  );
}

export function deactivate() {}
