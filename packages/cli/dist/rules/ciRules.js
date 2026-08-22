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
exports.ciRules = void 0;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const scanner_core_1 = require("@assurly/scanner-core");
const WORKFLOW_PATTERN = /^\.github\/workflows\/.*\.(ya?ml)$/i;
const SCAN_STEP_PATTERN = /assurly|npm\s+run\s+scan(?::self)?|npx\s+assurly\s+scan/i;
function workflowRunsScanStep(content) {
    return SCAN_STEP_PATTERN.test(content);
}
/**
 * CI/CD Rule — hints when no workflow runs an Assurly scan; never blocks.
 */
exports.ciRules = {
    id: 'github-actions-integration',
    name: 'GitHub Actions CI/CD Integration',
    description: 'Ensures the project is configured with a GitHub Actions workflow for automatic Assurly scans.',
    severity: 'warning',
    async run(context) {
        const workflowFiles = context.files.filter((file) => WORKFLOW_PATTERN.test(file.replace(/\\/g, '/')));
        for (const workflowFile of workflowFiles) {
            try {
                const content = fs.readFileSync(path.join(context.projectPath, workflowFile), 'utf8');
                if (workflowRunsScanStep(content)) {
                    return [];
                }
            }
            catch {
                // Ignore unreadable workflow files and keep checking others.
            }
        }
        return [
            {
                ruleId: this.id,
                severity: 'warning',
                message: (0, scanner_core_1.githubActionsIntegrationMessage)(workflowFiles.length),
                suggestion: scanner_core_1.GITHUB_ACTIONS_INIT_SUGGESTION,
            },
        ];
    },
};
