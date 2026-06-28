"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createScanProcess = createScanProcess;
const path = require("path");
function createScanProcess(extensionPath, workspacePath, executable = process.execPath) {
    return {
        executable,
        args: [path.join(extensionPath, 'vendor', 'shipready-cli.js'), 'scan', '--path', workspacePath],
        options: { cwd: workspacePath, windowsHide: true },
    };
}
//# sourceMappingURL=cliProcess.js.map