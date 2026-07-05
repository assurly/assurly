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
exports.listFiles = listFiles;
exports.detectStack = detectStack;
exports.buildContext = buildContext;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const scanner_core_1 = require("@shipready/scanner-core");
/**
 * Recursively scans a directory to list all file paths, ignoring common system/dependency folders.
 */
function listFiles(dir, baseDir = dir) {
    let results = [];
    if (!fs.existsSync(dir)) {
        return results;
    }
    const items = fs.readdirSync(dir);
    for (const item of items) {
        const fullPath = path.join(dir, item);
        const stat = fs.statSync(fullPath);
        // Ignore dependency, build, and system folders
        if (item === 'node_modules' ||
            item === '.git' ||
            item === '.next' ||
            item === 'dist' ||
            item === 'build' ||
            item === 'coverage' ||
            item === '.DS_Store') {
            continue;
        }
        if (stat.isDirectory()) {
            results = results.concat(listFiles(fullPath, baseDir));
        }
        else if (stat.isFile()) {
            // Return path relative to the project root
            results.push(path.relative(baseDir, fullPath));
        }
    }
    return results;
}
/**
 * Detects the technologies used in the project by reading package.json and file structure.
 */
function detectStack(projectPath) {
    const stack = {
        framework: 'unknown',
        database: 'none',
        payments: 'none',
        deployment: 'unknown',
    };
    const packageJsonPath = path.join(projectPath, 'package.json');
    if (!fs.existsSync(packageJsonPath)) {
        return stack;
    }
    try {
        const packageJsonContent = fs.readFileSync(packageJsonPath, 'utf8');
        const packageJson = JSON.parse(packageJsonContent);
        const allDeps = {
            ...(packageJson.dependencies || {}),
            ...(packageJson.devDependencies || {}),
        };
        // Framework detection
        if (allDeps['next']) {
            stack.framework = 'nextjs';
        }
        // Database detection
        if (allDeps['@supabase/supabase-js'] || allDeps['@supabase/ssr']) {
            stack.database = 'supabase';
        }
        else if (allDeps['prisma'] || allDeps['@prisma/client']) {
            stack.database = 'prisma';
        }
        // Payments detection
        if (allDeps['stripe'] || allDeps['@stripe/stripe-js']) {
            stack.payments = 'stripe';
        }
        // Deployment platform heuristic
        if (fs.existsSync(path.join(projectPath, 'vercel.json')) || allDeps['@vercel/analytics']) {
            stack.deployment = 'vercel';
        }
        else if (stack.framework === 'nextjs') {
            // Default deployment platform for Next.js is Vercel
            stack.deployment = 'vercel';
        }
    }
    catch (error) {
        // If json parsing fails, fallback to defaults
    }
    return stack;
}
/**
 * Builds the project context by scanning the target directory.
 */
function buildContext(projectPath) {
    const detectedStack = detectStack(projectPath);
    const allFiles = listFiles(projectPath);
    const files = allFiles.filter(scanner_core_1.isScannableFile);
    const scanScope = (0, scanner_core_1.buildScanScope)(allFiles, files);
    return {
        projectPath,
        detectedStack,
        files,
        scanScope,
    };
}
