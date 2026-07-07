import * as path from 'path';

export interface ScanProcess {
  executable: string;
  args: string[];
  options: { cwd: string; windowsHide: true };
}

export function createScanProcess(
  extensionPath: string,
  workspacePath: string,
  executable = process.execPath,
): ScanProcess {
  return {
    executable,
    args: [path.join(extensionPath, 'vendor', 'assurly-cli.js'), 'scan', '--path', workspacePath],
    options: { cwd: workspacePath, windowsHide: true },
  };
}
