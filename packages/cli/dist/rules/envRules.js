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
    catch (e) {
        // Ignore read errors
    }
    return keys;
}
exports.envRules = {
    id: 'env-vars-validator',
    name: 'Environment Variables Validation',
    description: 'Verifies env file consistency and checks for undocumented environment variables in the codebase.',
    severity: 'error',
    async run(context) {
        const findings = [];
        const rootPath = context.projectPath;
        const examplePath = path.join(rootPath, '.env.example');
        const hasExample = fs.existsSync(examplePath);
        if (!hasExample) {
            findings.push({
                ruleId: this.id,
                severity: 'warning',
                message: 'No .env.example file found at the root of the project. It is highly recommended to document your environment variables.',
            });
            return findings;
        }
        // Parse keys from .env.example
        const exampleKeys = parseEnvFile(examplePath);
        // Find local environment files (.env, .env.local, .env.development)
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
        // Rule 1: Check if any key from .env.example is missing in local .env configuration
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
        const exampleContent = fs.readFileSync(examplePath, 'utf8');
        findings.push(...(0, scanner_core_1.scanEnvVariables)(exampleContent, '', '.env.example', 'code.ts').findings);
        const srcFiles = context.files.filter((f) => (f.startsWith('src/') ||
            f.startsWith('app/') ||
            f.startsWith('pages/') ||
            f.startsWith('components/')) &&
            /\.(js|ts|jsx|tsx)$/.test(f));
        for (const file of srcFiles) {
            try {
                const fullPath = path.join(rootPath, file);
                const content = fs.readFileSync(fullPath, 'utf8');
                findings.push(...(0, scanner_core_1.scanEnvVariables)(exampleContent, content, '.env.example', file).findings.filter((finding) => finding.ruleId === 'undocumented-env'));
            }
            catch (e) {
                // Ignore read errors
            }
        }
        return findings;
    },
};
