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
exports.deeperStackRules = void 0;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const child_process_1 = require("child_process");
const scanner_core_1 = require("@shipready/scanner-core");
/**
 * Returns the subset of `files` that are NOT gitignored. A pre-ship scan should
 * analyze what actually ships, so gitignored files (e.g. a developer's local
 * `.env.local` holding real secrets) must not produce blockers. Falls back to
 * returning every file when the project is not a git repo or git is unavailable.
 */
function excludeGitIgnored(projectPath, files) {
    if (files.length === 0)
        return files;
    try {
        const ignored = new Set();
        // `git check-ignore --stdin` prints the paths it considers ignored and
        // exits 1 when none match (which execFileSync surfaces as a thrown error
        // carrying stdout), so read stdout in both the success and no-match cases.
        let stdout = '';
        try {
            stdout = (0, child_process_1.execFileSync)('git', ['check-ignore', '--stdin'], {
                cwd: projectPath,
                input: files.join('\n'),
                encoding: 'utf8',
            });
        }
        catch (error) {
            const status = error.status;
            // status 1 = "no paths ignored" (normal); anything else (e.g. 128 = not a
            // git repo) means we can't determine ignore status, so scan everything.
            if (status !== 1)
                return files;
            stdout = error.stdout ?? '';
        }
        for (const line of stdout.split(/\r?\n/)) {
            const trimmed = line.trim();
            if (trimmed)
                ignored.add(trimmed);
        }
        return files.filter((file) => !ignored.has(file));
    }
    catch {
        return files;
    }
}
/**
 * Phase 3 deeper-stack rules: auth boundaries, Supabase policy quality, Stripe
 * lifecycle, and Vercel maxDuration. Edge-runtime detection is intentionally
 * excluded here because `vercelRules` already runs it — see the
 * `includeEdgeRuntime` option on `runDeeperStackScans`.
 *
 * Each scanner carries its own severity + confidence, which the Ship Gate uses
 * to route findings (error+high → blocker, error+medium / warning → review), so
 * the granular ruleIds are preserved rather than remapped to this wrapper id.
 */
exports.deeperStackRules = {
    id: 'deeper-stack-rules',
    name: 'Deeper Stack Security (auth, Supabase, Stripe, Vercel)',
    description: 'Detects unguarded server actions/route handlers, service-role bypasses, permissive Supabase policies, Stripe lifecycle gaps, and missing maxDuration.',
    severity: 'error',
    async run(context) {
        const candidates = context.files
            .filter((file) => /\.(?:js|ts|jsx|tsx|sql)$/.test(file) ||
            /(?:^|\/)\.env(?:\.(?:local|development|dev|test|staging))?$/.test(file))
            .filter((file) => !/\.(?:test|spec)\./.test(file));
        const sources = excludeGitIgnored(context.projectPath, candidates).map((file) => ({
            file,
            content: fs.readFileSync(path.join(context.projectPath, file), 'utf8'),
        }));
        return (0, scanner_core_1.runDeeperStackScans)(sources, { includeEdgeRuntime: false }).findings;
    },
};
