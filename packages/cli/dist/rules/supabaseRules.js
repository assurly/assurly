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
exports.supabaseRules = void 0;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const scanner_core_1 = require("@assurly/scanner-core");
exports.supabaseRules = {
    id: 'supabase-security-checks',
    name: 'Supabase Security Validation',
    description: 'Checks RLS configuration and service-role exposure in client code.',
    severity: 'error',
    async run(context) {
        const read = (file) => fs.readFileSync(path.join(context.projectPath, file), 'utf8');
        const sql = context.files
            .filter((file) => file.endsWith('.sql'))
            .map((file) => ({ file, content: read(file) }));
        if (context.detectedStack.database !== 'supabase') {
            // Tables no browser can reach: the unscored "Good to know" note the
            // dashboard shows, so both channels report the same database.
            return (0, scanner_core_1.scanSqlMigrations)(sql, { usesSupabase: false }).findings.filter(scanner_core_1.isDatabaseSafetyNetAdvisory);
        }
        const findings = [];
        const sqlFindings = (0, scanner_core_1.scanSqlMigrations)(sql, { usesSupabase: true }).findings;
        // Kept under its own rule id: findingKind files it as an unscored note.
        findings.push(...sqlFindings.filter(scanner_core_1.isRlsWithoutPolicyAdvisory));
        // Findings keep scanner-core's own rule ids and messages, exactly as the
        // dashboard reports them: consequence copy, the AI fix prompt and live
        // confirmation are keyed by those ids, and a wrapper id matched none.
        findings.push(...sqlFindings.filter((finding) => finding.ruleId === 'supabase-rls'));
        for (const file of context.files.filter((candidate) => candidate.startsWith('.env'))) {
            findings.push(...(0, scanner_core_1.scanEnvVariables)(read(file), '', file, 'code.ts').findings.filter((finding) => finding.ruleId === 'public-secret'));
        }
        for (const file of context.files.filter((candidate) => /\.(?:js|ts|jsx|tsx)$/.test(candidate))) {
            findings.push(...(0, scanner_core_1.scanSupabaseClientLeaks)(read(file), file).findings);
        }
        return findings;
    },
};
