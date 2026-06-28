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
exports.tsconfigRules = void 0;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
/**
 * Strips single-line and multi-line comments from JSON string.
 */
function stripJsonComments(jsonString) {
    return jsonString.replace(/("([^"\\]|\\.)*")|(\/\/.*|\/\*[\s\S]*?\*\/)/g, (m, g) => (g ? m : ''));
}
/**
 * Rule to check if strict mode is enabled in tsconfig.json.
 */
exports.tsconfigRules = {
    id: 'typescript-strict-mode',
    name: 'TypeScript Strict Mode Validation',
    description: 'Ensures compilerOptions.strict is set to true in tsconfig.json to enforce maximum type safety.',
    severity: 'warning',
    async run(context) {
        const findings = [];
        const tsconfigPath = 'tsconfig.json';
        const fullPath = path.join(context.projectPath, tsconfigPath);
        const hasTsconfig = context.files.includes(tsconfigPath) || fs.existsSync(fullPath);
        if (!hasTsconfig) {
            findings.push({
                ruleId: this.id,
                severity: 'warning',
                message: 'No tsconfig.json file found in project root. TypeScript configuration is missing.',
                suggestion: 'Create a tsconfig.json in the project root and configure "strict": true in compilerOptions.',
            });
            return findings;
        }
        try {
            const content = fs.readFileSync(fullPath, 'utf8');
            const cleanContent = stripJsonComments(content);
            const parsed = JSON.parse(cleanContent);
            const strictEnabled = parsed?.compilerOptions?.strict === true;
            if (!strictEnabled) {
                findings.push({
                    ruleId: this.id,
                    severity: 'warning',
                    file: tsconfigPath,
                    message: 'TypeScript strict mode is disabled or not set. "strict": true is highly recommended for B2B SaaS applications to prevent runtime crashes.',
                    suggestion: 'Set "strict": true inside the "compilerOptions" block of your tsconfig.json.',
                });
            }
        }
        catch (error) {
            findings.push({
                ruleId: this.id,
                severity: 'warning',
                file: tsconfigPath,
                message: `Failed to parse tsconfig.json: ${error.message || error}.`,
                suggestion: 'Verify that tsconfig.json is a valid JSON file (with or without comments).',
            });
        }
        return findings;
    },
};
