"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GITHUB_ACTIONS_INIT_SUGGESTION = exports.GITHUB_ACTIONS_EXISTING_CI_MESSAGE = exports.GITHUB_ACTIONS_MISSING_ASSURLY_MESSAGE = void 0;
exports.githubActionsIntegrationMessage = githubActionsIntegrationMessage;
exports.scanTsconfigStrict = scanTsconfigStrict;
exports.scanGithubActionsIntegration = scanGithubActionsIntegration;
exports.scanHardcodedStripeSecrets = scanHardcodedStripeSecrets;
exports.scanWorkspaceFiles = scanWorkspaceFiles;
const gitIgnore_1 = require("./gitIgnore");
const fileRelevance_1 = require("./fileRelevance");
const agentStack_1 = require("./agentStack");
const supplyChain_1 = require("./supplyChain");
const index_1 = require("./index");
const result = (findings) => ({
    errorCount: findings.filter((finding) => finding.severity === 'error').length,
    warningCount: findings.filter((finding) => finding.severity === 'warning').length,
    findings,
});
const STRIPE_SECRET_KEY_PATTERN = /sk_(?:live|test)_[a-zA-Z0-9]{24,}/g;
const WORKFLOW_PATTERN = /^\.github\/workflows\/.*\.(ya?ml)$/i;
const ASSURLY_SCAN_STEP_PATTERN = /assurly|npm\s+run\s+scan(?::self)?|npx\s+assurly\s+scan/i;
exports.GITHUB_ACTIONS_MISSING_ASSURLY_MESSAGE = 'GitHub Actions workflow for Assurly is missing.';
exports.GITHUB_ACTIONS_EXISTING_CI_MESSAGE = 'GitHub Actions workflows exist, but none runs the Assurly scan.';
exports.GITHUB_ACTIONS_INIT_SUGGESTION = 'Run "npx assurly init" to automatically generate the .github/workflows/assurly.yml workflow file.';
function githubActionsIntegrationMessage(existingWorkflowCount) {
    return existingWorkflowCount > 0
        ? exports.GITHUB_ACTIONS_EXISTING_CI_MESSAGE
        : exports.GITHUB_ACTIONS_MISSING_ASSURLY_MESSAGE;
}
function posixPath(filePath) {
    return filePath.replace(/\\/g, '/');
}
function findExact(files, relativePath) {
    return files.find((file) => posixPath(file.file) === relativePath);
}
function projectUsesStripe(files) {
    return files.some((file) => {
        const path = posixPath(file.file);
        if (/(^|\/)package\.json$/.test(path) && /["']stripe["']\s*:/.test(file.content))
            return true;
        if (/\.(?:js|ts|jsx|tsx)$/.test(path) &&
            /from\s+['"]stripe['"]|require\(\s*['"]stripe['"]\s*\)/.test(file.content)) {
            return true;
        }
        return false;
    });
}
const WORKSPACE_TSCONFIG = /^(apps|packages)\/[^/]+\/tsconfig\.json$/;
const MISSING_ROOT_TSCONFIG = {
    ruleId: 'typescript-strict-mode',
    severity: 'warning',
    message: 'No tsconfig.json file found in project root. TypeScript configuration is missing.',
    suggestion: 'Create a tsconfig.json in the project root and configure "strict": true in compilerOptions.',
};
function isWorkspacePackageTsconfig(filePath) {
    return WORKSPACE_TSCONFIG.test(posixPath(filePath));
}
function evaluateTsconfigStrict(file) {
    try {
        const cleanContent = file.content.replace(/("([^"\\]|\\.)*")|(\/\/.*|\/\*[\s\S]*?\*\/)/g, (match, quoted) => (quoted ? match : ''));
        const parsed = JSON.parse(cleanContent);
        if (parsed.compilerOptions?.strict === true)
            return [];
        return [
            {
                ruleId: 'typescript-strict-mode',
                severity: 'warning',
                file: file.file,
                message: 'TypeScript strict mode is disabled or not set. "strict": true is highly recommended for B2B SaaS applications to prevent runtime crashes.',
                suggestion: 'Set "strict": true inside the "compilerOptions" block of your tsconfig.json.',
            },
        ];
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return [
            {
                ruleId: 'typescript-strict-mode',
                severity: 'warning',
                file: file.file,
                message: `Failed to parse tsconfig.json: ${message}.`,
                suggestion: 'Verify that tsconfig.json is a valid JSON file (with or without comments).',
            },
        ];
    }
}
function scanTsconfigStrict(files) {
    const root = findExact(files, 'tsconfig.json');
    const targets = root ? [root] : files.filter((file) => isWorkspacePackageTsconfig(file.file));
    if (targets.length === 0)
        return result([MISSING_ROOT_TSCONFIG]);
    return result(targets.flatMap(evaluateTsconfigStrict));
}
function scanGithubActionsIntegration(files) {
    const workflows = files.filter((file) => WORKFLOW_PATTERN.test(posixPath(file.file)));
    if (workflows.some((file) => ASSURLY_SCAN_STEP_PATTERN.test(file.content))) {
        return result([]);
    }
    return result([
        {
            ruleId: 'github-actions-integration',
            severity: 'warning',
            message: githubActionsIntegrationMessage(workflows.length),
            suggestion: exports.GITHUB_ACTIONS_INIT_SUGGESTION,
        },
    ]);
}
function scanHardcodedStripeSecrets(files) {
    const findings = [];
    const textFiles = files.filter((file) => {
        const path = posixPath(file.file);
        return /\.(?:js|ts|jsx|tsx|json|ya?ml|md|txt)$/.test(path) && !path.includes('.env');
    });
    for (const file of textFiles) {
        file.content.split(/\r?\n/).forEach((line, index) => {
            STRIPE_SECRET_KEY_PATTERN.lastIndex = 0;
            for (const match of line.matchAll(STRIPE_SECRET_KEY_PATTERN)) {
                findings.push({
                    ruleId: 'stripe-secret-leak',
                    severity: 'error',
                    confidence: 'high',
                    file: file.file,
                    line: index + 1,
                    message: `CRITICAL KEY LEAK: Hardcoded Stripe secret key found in source file (${match[0].slice(0, 7)}...).`,
                    suggestion: 'Rotate the key and replace it with process.env.STRIPE_SECRET_KEY.',
                });
            }
        });
    }
    return result(findings);
}
/**
 * Browser-safe equivalent of `assurly scan`: same scanner-core rules, in-memory
 * files, no fs / git / ts-morph.
 */
function scanWorkspaceFiles(files) {
    const sources = (0, gitIgnore_1.excludeGitIgnoredFiles)(files.filter((file) => (0, fileRelevance_1.isScannableFile)(file.file)));
    const findings = [];
    const sqlSources = sources.filter((file) => posixPath(file.file).endsWith('.sql'));
    if (sqlSources.length > 0) {
        findings.push(...(0, index_1.scanSqlMigrations)(sqlSources).findings);
    }
    const codeFiles = sources.filter((file) => /\.(?:[jt]sx?)$/.test(posixPath(file.file)));
    const usesStripe = projectUsesStripe(sources);
    for (const file of codeFiles) {
        findings.push(...(0, index_1.scanRscDataLeaks)(file.content, file.file).findings);
        findings.push(...(0, index_1.scanSupabaseClientLeaks)(file.content, file.file).findings);
        findings.push(...(0, index_1.scanEdgeRuntime)(file.content, file.file).findings);
        findings.push(...(0, index_1.scanDbConnectionPooling)(file.content, file.file).findings);
        if ((0, index_1.isServerlessApiRouteFile)(file.file)) {
            findings.push(...(0, index_1.scanColdStart)(file.content, file.file).findings);
        }
        if (usesStripe) {
            findings.push(...(0, index_1.scanStripeWebhook)(file.content, file.file).findings);
        }
    }
    if (usesStripe) {
        findings.push(...scanHardcodedStripeSecrets(sources).findings);
    }
    findings.push(...(0, index_1.runDeeperStackScans)(sources, { includeEdgeRuntime: false }).findings);
    const allExamples = sources.filter((file) => /(?:^|\/)\.env\.example$/.test(posixPath(file.file)));
    const testOnlyKeys = (0, index_1.collectTestOnlyEnvKeys)(codeFiles);
    for (const file of allExamples) {
        findings.push(...(0, index_1.scanEnvVariables)(file.content, '', file.file, 'code.ts', { emitMissingCanary: false })
            .findings);
    }
    if (allExamples.length === 0) {
        findings.push({
            ruleId: 'env-vars-validator',
            severity: 'warning',
            message: 'No .env.example file found at the root of the project. It is highly recommended to document your environment variables.',
        });
    }
    else {
        findings.push(...(0, index_1.scanEnvVariables)(allExamples[0].content, '', allExamples[0].file, 'code.ts', {
            allExamples,
        }).findings.filter((finding) => finding.ruleId === 'assurly-canary-missing'));
        for (const file of codeFiles) {
            if (!(0, index_1.isAppEnvSourceFile)(file.file))
                continue;
            findings.push(...(0, index_1.scanEnvVariables)('', file.content, '.env.example', file.file, {
                allExamples,
                testOnlyKeys,
                emitMissingCanary: false,
            }).findings.filter((finding) => finding.file === file.file));
        }
    }
    const packageJson = findExact(sources, 'package.json');
    const packageLock = findExact(sources, 'package-lock.json');
    const npmrc = findExact(sources, '.npmrc');
    const workspacePackageJsons = sources
        .map((file) => ({ file: posixPath(file.file), content: file.content }))
        .filter((file) => file.file !== 'package.json' && /(^|\/)package\.json$/.test(file.file));
    findings.push(...(0, supplyChain_1.scanSupplyChain)({
        packageJson: packageJson?.content ?? null,
        packageLock: packageLock?.content ?? null,
        npmrc: npmrc?.content ?? null,
        workspacePackageJsons,
    }).findings);
    for (const file of sources) {
        if (!(0, agentStack_1.isAgentStackFile)(posixPath(file.file)))
            continue;
        findings.push(...(0, agentStack_1.scanAgentStack)(file.content, posixPath(file.file)).findings);
    }
    findings.push(...scanTsconfigStrict(sources).findings);
    findings.push(...scanGithubActionsIntegration(sources).findings);
    return result(findings);
}
