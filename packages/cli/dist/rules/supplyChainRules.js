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
exports.supplyChainRules = void 0;
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
function readProjectFile(projectPath, relativePath) {
    try {
        return fs.readFileSync(path.join(projectPath, relativePath), 'utf8');
    }
    catch {
        return null;
    }
}
/**
 * Install-time trust — audits npm 12+ allowScripts / lockfile install scripts /
 * non-registry deps. Runs in every scan by default (offline, cheap). Individual
 * findings keep their scanner-core rule ids; this wrapper id is never a ship
 * blocker.
 *
 * See packages/scanner-core/src/supplyChain.ts for the product decision that
 * every `supply-*` finding is warning-only.
 */
exports.supplyChainRules = {
    id: 'supply-chain',
    name: 'Install-time trust (npm allowScripts)',
    description: 'Audits install-script allowlists, lockfile hasInstallScript packages, non-registry dependencies, and npm version pins — all from local project files.',
    severity: 'warning',
    async run(context) {
        const packageJson = readProjectFile(context.projectPath, 'package.json');
        const packageLock = readProjectFile(context.projectPath, 'package-lock.json');
        // Project-root .npmrc only — never $HOME/.npmrc (auth tokens).
        const npmrc = readProjectFile(context.projectPath, '.npmrc');
        const workspacePackageJsons = context.files
            .map((file) => file.replace(/\\/g, '/'))
            .filter((file) => file !== 'package.json' && /(^|\/)package\.json$/.test(file))
            // Never read manifests under dependencies.
            .filter((file) => !file.includes('node_modules/'))
            .map((file) => {
            const content = readProjectFile(context.projectPath, file);
            if (content == null)
                return null;
            return { file, content };
        })
            .filter((entry) => entry !== null);
        const scan = (0, scanner_core_1.scanSupplyChain)({
            packageJson,
            packageLock,
            npmrc,
            workspacePackageJsons,
        });
        return scan.findings.map(toFinding);
    },
};
