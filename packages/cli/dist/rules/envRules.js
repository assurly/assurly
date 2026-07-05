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
exports.envRules = void 0;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const scanner_core_1 = require("@shipready/scanner-core");
/**
 * Parses a standard key-value .env file format.
 * Verified by unit tests.
 */
function parseEnvFile(filePath) {
    const keys = new Set();
    if (!fs.existsSync(filePath)) {
        return keys;
    }
    try {
        const content = fs.readFileSync(filePath, 'utf8');
        const lines = content.split(/\r?\n/);
        for (const line of lines) {
            const trimmed = line.trim();
            // Skip comments and empty lines
            if (!trimmed || trimmed.startsWith('#')) {
                continue;
            }
            const match = trimmed.match(/^([^=]+)=/);
            if (match) {
                keys.add(match[1].trim());
            }
        }
    }
    catch {
        // Ignore read errors
    }
    return keys;
}
function readFileContent(rootPath, relativePath) {
    try {
        return fs.readFileSync(path.join(rootPath, relativePath), 'utf8');
    }
    catch {
        return null;
    }
}
exports.envRules = {
    id: 'env-vars-validator',
    name: 'Environment Variables Validation',
    description: 'Verifies env file consistency and checks for undocumented environment variables in the codebase.',
    severity: 'error',
    async run(context) {
        const findings = [];
        const rootPath = context.projectPath;
        const examplePaths = context.files.filter((file) => file.endsWith('.env.example'));
        if (examplePaths.length === 0) {
            findings.push({
                ruleId: this.id,
                severity: 'warning',
                message: 'No .env.example file found at the root of the project. It is highly recommended to document your environment variables.',
            });
            return findings;
        }
        const allExamples = examplePaths.flatMap((file) => {
            const content = readFileContent(rootPath, file);
            return content ? [{ file, content }] : [];
        });
        const rootExamplePath = examplePaths.includes('.env.example')
            ? '.env.example'
            : examplePaths[0];
        const rootExampleContent = readFileContent(rootPath, rootExamplePath) ?? '';
        // Parse keys from root .env.example for local env consistency check
        const exampleKeys = parseEnvFile(path.join(rootPath, rootExamplePath));
        const localEnvFiles = ['.env.local', '.env.development', '.env'];
        let localKeys = new Set();
        let foundLocalFile = '';
        for (const file of localEnvFiles) {
            const fullPath = path.join(rootPath, file);
            if (fs.existsSync(fullPath)) {
                localKeys = parseEnvFile(fullPath);
                foundLocalFile = file;
                break;
            }
        }
        for (const key of exampleKeys) {
            if (foundLocalFile && !localKeys.has(key)) {
                findings.push({
                    ruleId: this.id,
                    severity: 'warning',
                    file: foundLocalFile,
                    message: `Environment variable '${key}' (declared in .env.example) is not defined in your local '${foundLocalFile}' file.`,
                    suggestion: `Add placeholder: ${key}=your_value`,
                });
            }
        }
        findings.push(...(0, scanner_core_1.scanEnvVariables)(rootExampleContent, '', rootExamplePath, 'code.ts', {
            allExamples,
        }).findings);
        const codeSources = [];
        const srcFiles = context.files.filter((file) => (file.startsWith('src/') ||
            file.startsWith('app/') ||
            file.startsWith('apps/') ||
            file.startsWith('pages/') ||
            file.startsWith('components/')) &&
            /\.(js|ts|jsx|tsx)$/.test(file));
        for (const file of srcFiles) {
            const content = readFileContent(rootPath, file);
            if (content)
                codeSources.push({ file, content });
        }
        const testOnlyKeys = (0, scanner_core_1.collectTestOnlyEnvKeys)([
            ...codeSources,
            ...context.files
                .filter((file) => /\.(js|ts|jsx|tsx)$/.test(file) && !codeSources.some((s) => s.file === file))
                .flatMap((file) => {
                const content = readFileContent(rootPath, file);
                return content ? [{ file, content }] : [];
            }),
        ]);
        for (const source of codeSources) {
            findings.push(...(0, scanner_core_1.scanEnvVariables)(rootExampleContent, source.content, rootExamplePath, source.file, {
                allExamples,
                testOnlyKeys,
            }).findings.filter((finding) => finding.ruleId === 'undocumented-env'));
        }
        return findings;
    },
};
