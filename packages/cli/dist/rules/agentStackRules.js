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
exports.agentStackRules = void 0;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const scanner_core_1 = require("@assurly/scanner-core");
function toFinding(finding) {
    return {
        ruleId: finding.ruleId,
        severity: finding.severity,
        confidence: finding.confidence,
        file: finding.file,
        line: finding.line,
        message: finding.message,
        suggestion: finding.suggestion,
    };
}
/**
 * Agent Stack — audits MCP client configs and instruction files the AI agent
 * reads. Runs in every scan by default (offline, cheap). Individual findings
 * keep their scanner-core rule ids; this wrapper id is never a ship blocker.
 *
 * See packages/scanner-core/src/agentStack.ts for the product decision that
 * `agent-*` findings must never gate deploy.
 */
exports.agentStackRules = {
    id: 'agent-stack',
    name: 'Agent Stack (MCP configs & instruction files)',
    description: 'Audits the AI agent setup: MCP server configs and instruction files for shell execution, inline secrets, hidden instructions, and exfiltration directives.',
    severity: 'warning',
    async run(context) {
        const matches = context.files.filter((file) => (0, scanner_core_1.isAgentStackFile)(file.replace(/\\/g, '/')));
        const findings = [];
        for (const relativePath of matches) {
            try {
                const content = fs.readFileSync(path.join(context.projectPath, relativePath), 'utf8');
                const scan = (0, scanner_core_1.scanAgentStack)(content, relativePath.replace(/\\/g, '/'));
                findings.push(...scan.findings.map(toFinding));
            }
            catch {
                // Ignore unreadable files and keep checking others.
            }
        }
        return findings;
    },
};
