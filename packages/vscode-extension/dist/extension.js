"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = require("vscode");
const child_process_1 = require("child_process");
const cliProcess_1 = require("./cliProcess");
const ANSI_PATTERN = /[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g;
function activate(context) {
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
        const child = (0, cliProcess_1.createScanProcess)(context.extensionPath, workspace.uri.fsPath);
        (0, child_process_1.execFile)(child.executable, child.args, child.options, (error, stdout, stderr) => {
            if (stdout)
                output.append(stdout.replace(ANSI_PATTERN, ''));
            if (stderr)
                output.append(stderr.replace(ANSI_PATTERN, ''));
            if (error) {
                void vscode.window.showErrorMessage('ShipReady detected configuration or security issues. See the Output channel.');
            }
            else {
                void vscode.window.showInformationMessage('ShipReady scan completed successfully.');
            }
        });
    });
    context.subscriptions.push(disposable, output);
}
function deactivate() { }
//# sourceMappingURL=extension.js.map