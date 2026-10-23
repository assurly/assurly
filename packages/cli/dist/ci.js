"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.setupGitHubAction = setupGitHubAction;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
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

      - name: Assurly Live Lock
        env:
          ASSURLY_API_KEY: \${{ secrets.ASSURLY_API_KEY }}
          ASSURLY_TARGET_URL: \${{ secrets.ASSURLY_TARGET_URL }}
          ASSURLY_API_URL: \${{ secrets.ASSURLY_API_URL }}
        run: |
          node --input-type=module <<'NODE'
          const key = process.env.ASSURLY_API_KEY || '';
          const target = process.env.ASSURLY_TARGET_URL || '';
          if (!key || !target) {
            console.log('Live Lock skipped: set ASSURLY_API_KEY and ASSURLY_TARGET_URL to require it.');
            process.exit(0);
          }
          const api = (process.env.ASSURLY_API_URL || 'https://assurly.dev').replace(/\\/$/, '');
          const response = await fetch(api + '/api/v1/live-lock', {
            method: 'POST',
            headers: {
              Authorization: 'Bearer ' + key,
              'Content-Type': 'application/json',
              Accept: 'application/json',
            },
            body: JSON.stringify({
              url: target,
              gitSha: process.env.GITHUB_SHA,
              attemptId: String(process.env.GITHUB_RUN_ID) + '.' + String(process.env.GITHUB_RUN_ATTEMPT),
            }),
          });
          const payload = await response.json().catch(() => ({}));
          console.log(JSON.stringify(payload));
          if (!response.ok || payload.status !== 'ready') {
            console.error('Live Lock blocked this deploy.');
            process.exit(1);
          }
          NODE
`;
/**
 * Creates the .github/workflows/assurly.yml file inside target directory.
 */
function setupGitHubAction(targetPath) {
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
    }
    catch (error) {
        return {
            success: false,
            message: `Failed to create workflow file: ${error instanceof Error ? error.message : String(error)}`,
        };
    }
}
