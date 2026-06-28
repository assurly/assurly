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
/**
 * CI/CD Rule to verify if the project has the GitHub Actions integration set up.
 */
exports.ciRules = {
    id: 'github-actions-cicd',
    name: 'GitHub Actions CI/CD Integration',
    description: 'Ensures the project is configured with a GitHub Actions workflow for automatic ShipReady scans.',
    severity: 'warning',
    async run(context) {
        const findings = [];
        const workflowPath = path.join('.github', 'workflows', 'shipready.yml');
        // Normalize slashes for cross-platform matching in context.files
        const hasWorkflowInContext = context.files.some((file) => {
            const normalized = file.replace(/\\/g, '/');
            return normalized === '.github/workflows/shipready.yml';
        });
        // Fallback: direct filesystem check
        const hasWorkflowOnFile = fs.existsSync(path.join(context.projectPath, workflowPath));
        if (!hasWorkflowInContext && !hasWorkflowOnFile) {
            findings.push({
                ruleId: this.id,
                severity: 'warning',
                message: 'GitHub Actions workflow for ShipReady is missing.',
                suggestion: 'Run "npx shipready init" to automatically generate the .github/workflows/shipready.yml workflow file.',
            });
        }
        return findings;
    },
};
