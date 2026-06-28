import * as vscode from 'vscode';
import { execFile } from 'child_process';
import { createScanProcess } from './cliProcess';

const ANSI_PATTERN = /[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g;

export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel('ShipReady');
  const disposable = vscode.commands.registerCommand('shipready.scan', () => {
    const workspace = vscode.workspace.workspaceFolders?.[0];
    if (!workspace) {
      void vscode.window.showErrorMessage('No workspace open to scan.');
      return;
    }

    output.clear();
    output.show();
    output.appendLine('Starting ShipReady scan...');
    const child = createScanProcess(context.extensionPath, workspace.uri.fsPath);
    execFile(child.executable, child.args, child.options, (error, stdout, stderr) => {
      if (stdout) output.append(stdout.replace(ANSI_PATTERN, ''));
      if (stderr) output.append(stderr.replace(ANSI_PATTERN, ''));
      if (error) {
        void vscode.window.showErrorMessage(
          'ShipReady detected configuration or security issues. See the Output channel.',
        );
      } else {
        void vscode.window.showInformationMessage('ShipReady scan completed successfully.');
      }
    });
  });
  context.subscriptions.push(disposable, output);
}

export function deactivate(): void {}
