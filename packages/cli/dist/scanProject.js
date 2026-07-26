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
exports.runAllRules = runAllRules;
exports.scanProjectDirectory = scanProjectDirectory;
exports.scanProjectFiles = scanProjectFiles;
const fs = __importStar(require("fs"));
const os = __importStar(require("os"));
const path = __importStar(require("path"));
const scanner_core_1 = require("@assurly/scanner-core");
const detector_1 = require("./detector");
const rules_1 = require("./rules");
const shipGateReporter_1 = require("./shipGateReporter");
function ruleErrorMessage(error) {
    if (error instanceof Error)
        return error.message;
    return String(error);
}
async function runAllRules(context, options = {}) {
    const rules = options.agentOnly ? rules_1.allRules.filter((rule) => rule.id === 'agent-stack') : rules_1.allRules;
    const findings = [];
    for (const rule of rules) {
        try {
            const ruleFindings = await rule.run(context);
            findings.push(...ruleFindings);
        }
        catch (ruleError) {
            findings.push({
                ruleId: rule.id,
                severity: 'error',
                message: `Rule failed to execute: ${ruleErrorMessage(ruleError)}`,
            });
        }
    }
    return findings;
}
function buildScanProjectResult(findings, context) {
    const report = (0, shipGateReporter_1.buildCliShipGateReport)(findings, context.files.length, context.scanScope);
    return {
        findings,
        report,
        context,
        summary: (0, scanner_core_1.formatShipGatePlainText)(report),
        markdown: (0, scanner_core_1.formatShipGateMarkdown)(report),
    };
}
async function scanProjectDirectory(projectPath, options = {}) {
    const resolvedPath = path.resolve(projectPath);
    const context = (0, detector_1.buildContext)(resolvedPath);
    const findings = await runAllRules(context, options);
    return buildScanProjectResult(findings, context);
}
async function scanProjectFiles(files, options = {}) {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'assurly-scan-'));
    try {
        for (const file of files) {
            const normalizedPath = file.path.replace(/\\/g, '/');
            const fullPath = path.join(tempDir, normalizedPath);
            fs.mkdirSync(path.dirname(fullPath), { recursive: true });
            fs.writeFileSync(fullPath, file.content, 'utf8');
        }
        return await scanProjectDirectory(tempDir, options);
    }
    finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
    }
}
