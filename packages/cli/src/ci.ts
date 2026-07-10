import * as fs from 'fs';
import * as path from 'path';

// Assurly scans source files statically — it needs neither the project's
// dependencies installed nor a lockfile, so the workflow does not run `npm ci`
// (which would fail on repos whose package.json lives in a subdirectory) and
// omits setup-node's `cache: 'npm'` (which itself requires a root lockfile).
const WORKFLOW_TEMPLATE = `name: Assurly Security & Config Scan

on:
  push:
    branches: [ main, master, develop ]
  pull_request:
    branches: [ main, master, develop ]

jobs:
  scan:
    name: Assurly Static Analysis
    runs-on: ubuntu-latest

    steps:
      - name: Checkout repository
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 20

      - name: Run Assurly Scan
        run: npx --yes assurly@1 scan
`;

/**
 * Creates the .github/workflows/assurly.yml file inside target directory.
 */
export function setupGitHubAction(targetPath: string): {
  success: boolean;
  message: string;
  filePath?: string;
} {
  try {
    const githubDir = path.join(targetPath, '.github');
    const workflowsDir = path.join(githubDir, 'workflows');
    const workflowFile = path.join(workflowsDir, 'assurly.yml');

    if (!fs.existsSync(githubDir)) {
      fs.mkdirSync(githubDir, { recursive: true });
    }
    if (!fs.existsSync(workflowsDir)) {
      fs.mkdirSync(workflowsDir, { recursive: true });
    }

    fs.writeFileSync(workflowFile, WORKFLOW_TEMPLATE, 'utf8');

    return {
      success: true,
      message: 'GitHub Actions workflow successfully created at .github/workflows/assurly.yml!',
      filePath: workflowFile,
    };
  } catch (error: unknown) {
    return {
      success: false,
      message: `Failed to create workflow file: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
