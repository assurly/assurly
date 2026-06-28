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
const WORKFLOW_TEMPLATE = `name: ShipReady Security & Config Scan

on:
  push:
    branches: [ main, master, develop ]
  pull_request:
    branches: [ main, master, develop ]

jobs:
  scan:
    name: ShipReady Static Analysis
    runs-on: ubuntu-latest

    steps:
      - name: Checkout repository
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: 'npm'

      - name: Install dependencies
        run: npm ci --prefer-offline --no-audit

      - name: Run ShipReady Scan
        run: npx --yes @shipready/cli@1.0.0 scan
`;
/**
 * Creates the .github/workflows/shipready.yml file inside target directory.
 */
function setupGitHubAction(targetPath) {
    try {
        const githubDir = path.join(targetPath, '.github');
        const workflowsDir = path.join(githubDir, 'workflows');
        const workflowFile = path.join(workflowsDir, 'shipready.yml');
        if (!fs.existsSync(githubDir)) {
            fs.mkdirSync(githubDir, { recursive: true });
        }
        if (!fs.existsSync(workflowsDir)) {
            fs.mkdirSync(workflowsDir, { recursive: true });
        }
        fs.writeFileSync(workflowFile, WORKFLOW_TEMPLATE, 'utf8');
        return {
            success: true,
            message: 'GitHub Actions workflow successfully created at .github/workflows/shipready.yml!',
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
