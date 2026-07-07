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
exports.stripeRules = void 0;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const scanner_core_1 = require("@assurly/scanner-core");
const secretKeyPattern = /sk_(?:live|test)_[a-zA-Z0-9]{24,}/g;
exports.stripeRules = {
    id: 'stripe-integration-security',
    name: 'Stripe Security Validation',
    description: 'Verifies Stripe webhook signatures and detects leaked Stripe secret keys.',
    severity: 'error',
    async run(context) {
        if (context.detectedStack.payments !== 'stripe')
            return [];
        const findings = [];
        const codeFiles = context.files.filter((file) => /\.(?:js|ts|jsx|tsx)$/.test(file));
        for (const file of codeFiles) {
            const content = fs.readFileSync(path.join(context.projectPath, file), 'utf8');
            findings.push(...(0, scanner_core_1.scanStripeWebhook)(content, file).findings);
        }
        const textFiles = context.files.filter((file) => /\.(?:js|ts|jsx|tsx|json|yml|yaml|md|txt)$/.test(file) && !file.includes('.env'));
        for (const file of textFiles) {
            const lines = fs.readFileSync(path.join(context.projectPath, file), 'utf8').split(/\r?\n/);
            lines.forEach((line, index) => {
                secretKeyPattern.lastIndex = 0;
                for (const match of line.matchAll(secretKeyPattern)) {
                    findings.push({
                        ruleId: this.id,
                        severity: 'error',
                        file,
                        line: index + 1,
                        message: `CRITICAL KEY LEAK: Hardcoded Stripe secret key found in source file (${match[0].slice(0, 7)}...).`,
                        suggestion: 'Rotate the key and replace it with process.env.STRIPE_SECRET_KEY.',
                    });
                }
            });
        }
        for (const file of context.files.filter((candidate) => candidate.startsWith('.env'))) {
            const content = fs.readFileSync(path.join(context.projectPath, file), 'utf8');
            if (/NEXT_PUBLIC_STRIPE_(?:SECRET_KEY|SK)/.test(content)) {
                findings.push({
                    ruleId: this.id,
                    severity: 'error',
                    file,
                    message: 'Stripe secret key uses a NEXT_PUBLIC_ prefix and would be exposed to browsers.',
                    suggestion: 'Rename it to STRIPE_SECRET_KEY and use it only in server-side code.',
                });
            }
        }
        return findings;
    },
};
