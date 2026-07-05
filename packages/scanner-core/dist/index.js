"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveGroupAction = exports.isShipGateBlocked = exports.getFindingGroupKey = exports.formatShipGatePlainText = exports.formatShipGateMarkdown = exports.buildShipGateReport = exports.buildIssueGroups = exports.HIGH_CONFIDENCE_BLOCKER_RULE_IDS = exports.scanStripeWebhookIdempotency = exports.scanStripeMissingSubscriptionEvents = exports.scanStripeLiveKeyInDev = exports.scanStripeLifecycle = exports.scanSupabaseStorage = exports.scanSupabasePolicies = exports.scanSupabaseDeepPolicies = exports.scanAuthLinkedMigrationNoRls = exports.scanServiceRoleBypass = exports.scanServerActionAuth = exports.scanRouteHandlerAuth = exports.scanAuthBoundary = exports.scanAiRouteAuthz = exports.scanAiRateLimit = exports.scanAiPromptInjection = exports.scanAiPiiToModelContext = exports.scanAiLlmKeyLeak = exports.scanAiAppSecurity = exports.rankFilesByRelevance = exports.isScannableFile = exports.inferScanRoots = exports.getFileRelevanceScore = exports.formatScanScopeSummary = exports.buildScanScope = void 0;
exports.selectFiles = selectFiles;
exports.incompleteScanFinding = incompleteScanFinding;
exports.scanStripeWebhook = scanStripeWebhook;
exports.scanRscDataLeaks = scanRscDataLeaks;
exports.scanColdStart = scanColdStart;
exports.scanEdgeRuntime = scanEdgeRuntime;
exports.scanMaxDuration = scanMaxDuration;
exports.scanSqlMigrations = scanSqlMigrations;
exports.scanSqlMigration = scanSqlMigration;
exports.scanSupabaseClientLeaks = scanSupabaseClientLeaks;
exports.resolveEnvExampleForPath = resolveEnvExampleForPath;
exports.collectTestOnlyEnvKeys = collectTestOnlyEnvKeys;
exports.scanEnvVariables = scanEnvVariables;
exports.runDeeperStackScans = runDeeperStackScans;
const parser_1 = require("@babel/parser");
const fileRelevance_1 = require("./fileRelevance");
Object.defineProperty(exports, "buildScanScope", { enumerable: true, get: function () { return fileRelevance_1.buildScanScope; } });
Object.defineProperty(exports, "formatScanScopeSummary", { enumerable: true, get: function () { return fileRelevance_1.formatScanScopeSummary; } });
Object.defineProperty(exports, "getFileRelevanceScore", { enumerable: true, get: function () { return fileRelevance_1.getFileRelevanceScore; } });
Object.defineProperty(exports, "inferScanRoots", { enumerable: true, get: function () { return fileRelevance_1.inferScanRoots; } });
Object.defineProperty(exports, "isScannableFile", { enumerable: true, get: function () { return fileRelevance_1.isScannableFile; } });
Object.defineProperty(exports, "rankFilesByRelevance", { enumerable: true, get: function () { return fileRelevance_1.rankFilesByRelevance; } });
const authBoundary_1 = require("./authBoundary");
const supabasePolicies_1 = require("./supabasePolicies");
const stripeLifecycle_1 = require("./stripeLifecycle");
const result = (findings) => ({
    errorCount: findings.filter((finding) => finding.severity === 'error').length,
    warningCount: findings.filter((finding) => finding.severity === 'warning').length,
    findings,
});
function selectFiles(files, maxFiles) {
    const limit = maxFiles === undefined ? null : Math.max(1, Math.floor(maxFiles));
    const selected = limit === null ? [...files] : files.slice(0, limit);
    return {
        files: selected,
        total: files.length,
        complete: selected.length === files.length,
        limit,
    };
}
function incompleteScanFinding(selection) {
    if (selection.complete)
        return null;
    return {
        ruleId: 'scan-completeness',
        severity: 'warning',
        message: `Scan is incomplete: analyzed ${selection.files.length} of ${selection.total} eligible files (configured limit: ${selection.limit}).`,
        suggestion: 'Increase the scanner file limit or run the local CLI for a complete repository scan.',
    };
}
function parseCode(content) {
    return (0, parser_1.parse)(content, {
        sourceType: 'unambiguous',
        errorRecovery: true,
        plugins: ['typescript', 'jsx', 'decorators-legacy', 'classProperties', 'topLevelAwait'],
    });
}
function walk(node, visit) {
    if (!node || typeof node !== 'object')
        return;
    const candidate = node;
    if (typeof candidate.type === 'string')
        visit(candidate);
    for (const [key, value] of Object.entries(candidate)) {
        if (key === 'loc' || key === 'start' || key === 'end' || key === 'extra')
            continue;
        if (Array.isArray(value))
            value.forEach((item) => walk(item, visit));
        else if (value && typeof value === 'object')
            walk(value, visit);
    }
}
const lineOf = (node) => node.loc?.start?.line;
const memberName = (node) => {
    if (node.type !== 'MemberExpression' && node.type !== 'OptionalMemberExpression')
        return null;
    const property = node.property;
    if (!property)
        return null;
    if (property.type === 'Identifier')
        return String(property.name);
    if (property.type === 'StringLiteral')
        return String(property.value);
    return null;
};
function scanStripeWebhook(content, file = 'route.ts') {
    const findings = [];
    let ast;
    try {
        ast = parseCode(content);
    }
    catch {
        return result(findings);
    }
    let importsStripe = false;
    let readsStripeSignature = false;
    let usesStripeWebhookApi = false;
    let verifiesSignature = false;
    walk(ast, (node) => {
        if (node.type === 'ImportDeclaration') {
            const source = node.source;
            if (source?.value === 'stripe')
                importsStripe = true;
        }
        if (node.type === 'StringLiteral' && node.value === 'stripe-signature') {
            readsStripeSignature = true;
        }
        if (node.type === 'MemberExpression' || node.type === 'OptionalMemberExpression') {
            if (memberName(node) === 'webhooks')
                usesStripeWebhookApi = true;
        }
        if (node.type === 'CallExpression' || node.type === 'OptionalCallExpression') {
            const callee = node.callee;
            const name = callee ? memberName(callee) : null;
            if (name === 'constructEvent' || name === 'constructEventAsync')
                verifiesSignature = true;
        }
    });
    const webhookPath = /(^|[/\\._-])webhooks?([/\\._-]|$)/i.test(file) || !/[\\/]/.test(file);
    if ((webhookPath || readsStripeSignature || usesStripeWebhookApi) &&
        importsStripe &&
        !verifiesSignature) {
        findings.push({
            ruleId: 'stripe-webhook-signature',
            severity: 'error',
            file,
            line: 1,
            message: 'Stripe webhook endpoint appears to lack signature verification.',
            suggestion: 'Verify the raw request body with stripe.webhooks.constructEvent before processing the event.',
        });
    }
    return result(findings);
}
const serverPackages = new Set([
    'server-only',
    '@prisma/client',
    'pg',
    'mysql2',
    'mongodb',
    'mongoose',
    'redis',
    'sequelize',
]);
const sensitiveProps = new Set([
    'password',
    'secret',
    'token',
    'apikey',
    'privatekey',
    'clientsecret',
    'hashedpassword',
    'salt',
    'hash',
    'dbclient',
]);
function scanRscDataLeaks(content, file = 'component.tsx') {
    const findings = [];
    let ast;
    try {
        ast = parseCode(content);
    }
    catch {
        return result(findings);
    }
    const program = ast.program;
    const isClient = program?.directives?.some((directive) => directive.value?.value === 'use client') ?? false;
    walk(ast, (node) => {
        if (isClient && node.type === 'ImportDeclaration') {
            const source = String(node.source?.value ?? '');
            const lower = source.toLowerCase();
            const unsafe = [...serverPackages].some((pkg) => lower === pkg || lower.startsWith(`${pkg}/`)) ||
                ((source.startsWith('.') || source.startsWith('@/')) &&
                    (lower.includes('/db') ||
                        lower.endsWith('/db') ||
                        lower.includes('prisma') ||
                        lower.includes('supabaseadmin')));
            if (unsafe)
                findings.push({
                    ruleId: 'rsc-data-leaks',
                    severity: 'error',
                    // Heuristic: cannot distinguish `import type` from runtime imports.
                    confidence: 'medium',
                    file,
                    line: lineOf(node),
                    message: `Client Component imports server-side module '${source}'.`,
                    suggestion: 'Move database and secret-bearing code behind a Server Component, Server Action, or authenticated Route Handler.',
                });
        }
        if (!isClient && node.type === 'JSXAttribute') {
            const nameNode = node.name;
            const name = String(nameNode?.name ?? '').toLowerCase();
            const value = node.value;
            if (sensitiveProps.has(name) && value?.type === 'JSXExpressionContainer')
                findings.push({
                    ruleId: 'rsc-data-leaks',
                    severity: 'warning',
                    file,
                    line: lineOf(node),
                    message: `Potential Data Leak: sensitive prop '${name}' is serialized through JSX.`,
                    suggestion: 'Pass only explicitly selected, non-sensitive fields to client boundaries.',
                });
        }
    });
    return result(findings);
}
const heavyImports = {
    lodash: [
        "Importing the entire 'lodash' library slows serverless cold starts.",
        'Use a selective subpath import or a tree-shakeable alternative.',
    ],
    'aws-sdk': [
        "Importing the legacy 'aws-sdk' v2 significantly increases serverless bundle size.",
        'Use modular AWS SDK v3 clients.',
    ],
    firebase: [
        "Importing the full 'firebase' client bundle increases serverless cold starts.",
        'Use firebase-admin or modular imports on the server.',
    ],
    moment: [
        "Importing 'moment' adds a large non-tree-shakeable dependency.",
        'Use Intl, date-fns, dayjs, or Luxon.',
    ],
};
function scanColdStart(content, file = 'route.ts') {
    const findings = [];
    let ast;
    try {
        ast = parseCode(content);
    }
    catch {
        return result(findings);
    }
    walk(ast, (node) => {
        if (node.type !== 'ImportDeclaration')
            return;
        const source = String(node.source?.value ?? '');
        const details = heavyImports[source];
        if (details)
            findings.push({
                ruleId: 'cold-start-optimization',
                severity: 'warning',
                file,
                line: lineOf(node),
                message: details[0],
                suggestion: details[1],
            });
    });
    return result(findings);
}
const EDGE_FORBIDDEN_IMPORTS = new Set([
    'fs',
    'node:fs',
    'fs/promises',
    'node:fs/promises',
    'path',
    'node:path',
    'child_process',
    'node:child_process',
    'os',
    'node:os',
    'net',
    'node:net',
    'dns',
    'node:dns',
    'tls',
    'node:tls',
    'worker_threads',
    'node:worker_threads',
    '@prisma/client',
    'pg',
    'mysql2',
    'mongodb',
    'mongoose',
    'redis',
    'sequelize',
    'sharp',
    'bcrypt',
    'bcryptjs',
]);
function declaresEdgeRuntime(content, ast) {
    let edgeRuntime = false;
    walk(ast, (node) => {
        if (node.type !== 'ExportNamedDeclaration' && node.type !== 'VariableDeclarator')
            return;
        const declarator = node.type === 'ExportNamedDeclaration'
            ? (node.declaration?.type === 'VariableDeclaration'
                ? node.declaration.declarations?.[0]
                : undefined)
            : node;
        if (!declarator || declarator.type !== 'VariableDeclarator')
            return;
        const id = declarator.id;
        const init = declarator.init;
        if (id?.type === 'Identifier' &&
            id.name === 'runtime' &&
            init?.type === 'StringLiteral' &&
            init.value === 'edge') {
            edgeRuntime = true;
        }
    });
    return edgeRuntime || /export\s+const\s+runtime\s*=\s*['"]edge['"]/.test(content);
}
function scanEdgeRuntime(content, file = 'route.ts') {
    const findings = [];
    let ast;
    try {
        ast = parseCode(content);
    }
    catch {
        return result(findings);
    }
    if (!declaresEdgeRuntime(content, ast))
        return result(findings);
    const imports = [];
    walk(ast, (node) => {
        if (node.type === 'ImportDeclaration') {
            imports.push({
                source: String(node.source?.value ?? ''),
                line: lineOf(node),
            });
        }
    });
    for (const imported of imports) {
        const source = imported.source;
        if (EDGE_FORBIDDEN_IMPORTS.has(source) ||
            [...EDGE_FORBIDDEN_IMPORTS].some((pkg) => source.startsWith(`${pkg}/`) || source === pkg)) {
            findings.push({
                ruleId: 'vercel-edge-node-mismatch',
                severity: 'error',
                confidence: 'high',
                file,
                line: imported.line,
                message: `File '${file}' declares Edge Runtime but imports Node-only module '${source}'.`,
                suggestion: 'Remove the Edge Runtime configuration or replace Node-only imports with web-standard APIs.',
            });
        }
    }
    return result(findings);
}
const LONG_RUNNING_ROUTE_PATTERNS = [
    /\bstreamText\s*\(/,
    /\bstreamUI\s*\(/,
    /\$transaction\s*\(/,
    /\bwhile\s*\(\s*true\s*\)/,
    /\bsetTimeout\s*\(\s*[^,]+,\s*(?:[5-9]\d{3}|\d{5,})\s*\)/,
    /\.webhooks\.constructEvent(?:Async)?\s*\(/,
    /\bprisma\.[a-zA-Z_$]+\.(?:createMany|updateMany|deleteMany)\s*\(/,
];
function isRouteHandlerPath(file) {
    const normalized = file.replace(/\\/g, '/').toLowerCase();
    return (normalized.endsWith('/route.ts') ||
        normalized.endsWith('/route.js') ||
        normalized.endsWith('/route.tsx') ||
        normalized.endsWith('/route.jsx') ||
        normalized.includes('/api/'));
}
function scanMaxDuration(content, file = 'route.ts') {
    const findings = [];
    if (!isRouteHandlerPath(file))
        return result(findings);
    if (/\bmaxDuration\b/.test(content))
        return result(findings);
    const longRunningSignals = LONG_RUNNING_ROUTE_PATTERNS.filter((pattern) => pattern.test(content));
    if (longRunningSignals.length === 0)
        return result(findings);
    return result([
        {
            ruleId: 'vercel-maxduration-missing',
            severity: 'warning',
            confidence: 'low',
            file,
            line: 1,
            message: 'Route handler looks long-running but does not export maxDuration for Vercel serverless limits.',
            suggestion: 'Export maxDuration (seconds) on routes that stream, run transactions, or process webhooks.',
        },
    ]);
}
function scanSqlMigrations(sources) {
    const findings = [];
    const created = new Map();
    const rls = new Set();
    const normalize = (name) => name
        .replace(/['"`]/g, '')
        .replace(/^public\./i, '')
        .trim();
    for (const source of sources) {
        source.content.split(/\r?\n/).forEach((line, index) => {
            const code = line.replace(/--.*$/, '');
            const create = code.match(/create\s+table\s+(?:if\s+not\s+exists\s+)?([a-zA-Z0-9_."`'-]+)/i);
            const enabled = code.match(/alter\s+table\s+([a-zA-Z0-9_."`'-]+)\s+enable\s+row\s+level\s+security/i);
            if (create)
                created.set(normalize(create[1]), { file: source.file, line: index + 1 });
            if (enabled)
                rls.add(normalize(enabled[1]));
            if (/alter\s+table[\s\S]*\sadd\s+(?:column\s+)?[\s\S]*\snot\s+null/i.test(code) &&
                !/\bdefault\b/i.test(code)) {
                findings.push({
                    ruleId: 'database-migration-safety',
                    severity: 'error',
                    file: source.file,
                    line: index + 1,
                    message: 'Dangerous Migration: adding a NOT NULL column without a DEFAULT can fail on populated tables.',
                    suggestion: 'Add a safe default or backfill the nullable column before applying NOT NULL.',
                });
            }
        });
    }
    for (const [table, location] of created) {
        if (!rls.has(table) &&
            !['spatial_ref_sys', 'geography_columns', 'geometry_columns'].includes(table))
            findings.push({
                ruleId: 'supabase-rls',
                severity: 'error',
                file: location.file,
                line: location.line,
                message: `Supabase table '${table}' is created but Row-Level Security (RLS) is not enabled.`,
                suggestion: `Add SQL step: ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY;`,
            });
    }
    findings.push(...(0, supabasePolicies_1.scanSupabaseDeepPolicies)(sources).findings);
    return result(findings);
}
function scanSqlMigration(content, file = 'schema.sql') {
    return scanSqlMigrations([{ file, content }]);
}
function scanSupabaseClientLeaks(content, file = 'component.tsx') {
    const findings = [];
    let ast;
    try {
        ast = parseCode(content);
    }
    catch {
        return result(findings);
    }
    const program = ast.program;
    const isClient = program?.directives?.some((directive) => directive.value?.value === 'use client') ?? false;
    if (!isClient)
        return result(findings);
    let exposed = false;
    let exposedLine;
    walk(ast, (node) => {
        if (node.type === 'Identifier' && node.name === 'SUPABASE_SERVICE_ROLE_KEY') {
            exposed = true;
            exposedLine ?? (exposedLine = lineOf(node));
        }
        if (node.type === 'StringLiteral' &&
            /^NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY$/.test(String(node.value))) {
            exposed = true;
            exposedLine ?? (exposedLine = lineOf(node));
        }
    });
    if (exposed)
        findings.push({
            ruleId: 'supabase-service-role-leak',
            severity: 'error',
            file,
            line: exposedLine,
            message: 'Potential service_role key leakage in a Client Component.',
            suggestion: 'Move service-role operations to authenticated server-only code.',
        });
    return result(findings);
}
const FRAMEWORK_ENV_KEYS = new Set([
    'NODE_ENV',
    'CI',
    'VERCEL',
    'VERCEL_ENV',
    'NEXT_RUNTIME',
    'PORT',
]);
/** Fallback names documented via their public NEXT_PUBLIC_* counterpart. */
const DOCUMENTED_ENV_ALIASES = {
    SUPABASE_URL: ['NEXT_PUBLIC_SUPABASE_URL'],
    SUPABASE_ANON_KEY: ['NEXT_PUBLIC_SUPABASE_ANON_KEY'],
};
function isEnvKeyDocumented(key, keys) {
    if (keys.has(key))
        return true;
    const aliases = DOCUMENTED_ENV_ALIASES[key];
    return aliases?.some((alias) => keys.has(alias)) ?? false;
}
function isTestOrFixturePath(filePath) {
    if (!(0, fileRelevance_1.isScannableFile)(filePath))
        return true;
    const normalized = filePath.replace(/\\/g, '/').toLowerCase();
    return (normalized.includes('/testing/') ||
        normalized.includes('/__mocks__/') ||
        normalized.endsWith('playwright.config.ts'));
}
function parseExampleKeys(content) {
    const keys = new Set();
    content.split(/\r?\n/).forEach((raw) => {
        const line = raw.trim();
        if (!line || line.startsWith('#'))
            return;
        const key = line.split('=')[0]?.trim();
        if (key)
            keys.add(key);
    });
    return keys;
}
/** Resolve the nearest `.env.example` ancestor for a code path within a monorepo. */
function resolveEnvExampleForPath(codePath, examples) {
    const normalizedCode = codePath.replace(/\\/g, '/');
    const codeDir = normalizedCode.includes('/')
        ? normalizedCode.slice(0, normalizedCode.lastIndexOf('/'))
        : '';
    let best = null;
    let bestDirLength = -1;
    for (const example of examples) {
        const examplePath = example.file.replace(/\\/g, '/');
        if (!examplePath.endsWith('.env.example'))
            continue;
        const exampleDir = examplePath.includes('/')
            ? examplePath.slice(0, examplePath.lastIndexOf('/'))
            : '';
        const isAncestor = exampleDir === '' ||
            codeDir === exampleDir ||
            (exampleDir.length > 0 && codeDir.startsWith(`${exampleDir}/`));
        if (isAncestor && exampleDir.length >= bestDirLength) {
            best = example;
            bestDirLength = exampleDir.length;
        }
    }
    return best;
}
/** Collect env keys that appear exclusively in non-scannable (test/fixture) files. */
function collectTestOnlyEnvKeys(sources) {
    const prodKeys = new Set();
    const testKeys = new Set();
    for (const source of sources) {
        const isTestFile = isTestOrFixturePath(source.file);
        for (const match of source.content.matchAll(/process\.env\.([A-Z0-9_]+)/g)) {
            const key = match[1];
            if (isTestFile)
                testKeys.add(key);
            else
                prodKeys.add(key);
        }
    }
    const testOnly = new Set();
    for (const key of testKeys) {
        if (!prodKeys.has(key))
            testOnly.add(key);
    }
    return testOnly;
}
function scanExampleFileSecrets(exampleContent, exampleFile, findings) {
    exampleContent.split(/\r?\n/).forEach((raw, index) => {
        const line = raw.trim();
        if (!line || line.startsWith('#'))
            return;
        const key = line.split('=')[0]?.trim();
        if (/^NEXT_PUBLIC_(?:SUPABASE_SERVICE_ROLE_KEY|STRIPE_(?:SECRET_KEY|SK))\s*=/.test(line))
            findings.push({
                ruleId: 'public-secret',
                severity: 'error',
                file: exampleFile,
                line: index + 1,
                message: `'${key}' exposes a server secret to the browser.`,
                suggestion: 'Remove NEXT_PUBLIC_ and access the variable only in server-side code.',
            });
        const secret = line.match(/sk_(?:live|test)_[a-zA-Z0-9]{24,}/);
        if (secret)
            findings.push({
                ruleId: 'stripe-secret-leak',
                severity: 'error',
                file: exampleFile,
                line: index + 1,
                message: `CRITICAL KEY LEAK: Hardcoded Stripe secret key found (${secret[0].slice(0, 7)}...).`,
                suggestion: 'Use an empty example value and rotate the exposed key.',
            });
    });
}
function scanEnvVariables(exampleContent, codeContent, exampleFile = '.env.example', codeFile = 'code.ts', options = {}) {
    const findings = [];
    const resolvedExample = options.allExamples && options.allExamples.length > 0
        ? resolveEnvExampleForPath(codeFile, options.allExamples)
        : null;
    const activeExample = resolvedExample ?? { file: exampleFile, content: exampleContent };
    const keys = parseExampleKeys(activeExample.content);
    if (options.allExamples && options.allExamples.length > 0) {
        const scannedExampleFiles = new Set();
        for (const example of options.allExamples) {
            if (!example.file.endsWith('.env.example') || scannedExampleFiles.has(example.file)) {
                continue;
            }
            scannedExampleFiles.add(example.file);
            scanExampleFileSecrets(example.content, example.file, findings);
        }
    }
    else {
        scanExampleFileSecrets(exampleContent, exampleFile, findings);
    }
    codeContent.split(/\r?\n/).forEach((line, index) => {
        for (const match of line.matchAll(/process\.env\.([A-Z0-9_]+)/g)) {
            const key = match[1];
            if (FRAMEWORK_ENV_KEYS.has(key))
                continue;
            if (options.testOnlyKeys?.has(key))
                continue;
            if (!isEnvKeyDocumented(key, keys)) {
                const docPath = activeExample.file;
                findings.push({
                    ruleId: 'undocumented-env',
                    severity: 'error',
                    file: codeFile,
                    line: index + 1,
                    message: `Environment variable 'process.env.${key}' is used but not documented in '${docPath}'.`,
                    suggestion: `Add ${key}= to ${docPath}.`,
                });
            }
        }
    });
    return result(findings);
}
var aiAppSecurity_1 = require("./aiAppSecurity");
Object.defineProperty(exports, "scanAiAppSecurity", { enumerable: true, get: function () { return aiAppSecurity_1.scanAiAppSecurity; } });
Object.defineProperty(exports, "scanAiLlmKeyLeak", { enumerable: true, get: function () { return aiAppSecurity_1.scanAiLlmKeyLeak; } });
Object.defineProperty(exports, "scanAiPiiToModelContext", { enumerable: true, get: function () { return aiAppSecurity_1.scanAiPiiToModelContext; } });
Object.defineProperty(exports, "scanAiPromptInjection", { enumerable: true, get: function () { return aiAppSecurity_1.scanAiPromptInjection; } });
Object.defineProperty(exports, "scanAiRateLimit", { enumerable: true, get: function () { return aiAppSecurity_1.scanAiRateLimit; } });
Object.defineProperty(exports, "scanAiRouteAuthz", { enumerable: true, get: function () { return aiAppSecurity_1.scanAiRouteAuthz; } });
var authBoundary_2 = require("./authBoundary");
Object.defineProperty(exports, "scanAuthBoundary", { enumerable: true, get: function () { return authBoundary_2.scanAuthBoundary; } });
Object.defineProperty(exports, "scanRouteHandlerAuth", { enumerable: true, get: function () { return authBoundary_2.scanRouteHandlerAuth; } });
Object.defineProperty(exports, "scanServerActionAuth", { enumerable: true, get: function () { return authBoundary_2.scanServerActionAuth; } });
Object.defineProperty(exports, "scanServiceRoleBypass", { enumerable: true, get: function () { return authBoundary_2.scanServiceRoleBypass; } });
var supabasePolicies_2 = require("./supabasePolicies");
Object.defineProperty(exports, "scanAuthLinkedMigrationNoRls", { enumerable: true, get: function () { return supabasePolicies_2.scanAuthLinkedMigrationNoRls; } });
Object.defineProperty(exports, "scanSupabaseDeepPolicies", { enumerable: true, get: function () { return supabasePolicies_2.scanSupabaseDeepPolicies; } });
Object.defineProperty(exports, "scanSupabasePolicies", { enumerable: true, get: function () { return supabasePolicies_2.scanSupabasePolicies; } });
Object.defineProperty(exports, "scanSupabaseStorage", { enumerable: true, get: function () { return supabasePolicies_2.scanSupabaseStorage; } });
var stripeLifecycle_2 = require("./stripeLifecycle");
Object.defineProperty(exports, "scanStripeLifecycle", { enumerable: true, get: function () { return stripeLifecycle_2.scanStripeLifecycle; } });
Object.defineProperty(exports, "scanStripeLiveKeyInDev", { enumerable: true, get: function () { return stripeLifecycle_2.scanStripeLiveKeyInDev; } });
Object.defineProperty(exports, "scanStripeMissingSubscriptionEvents", { enumerable: true, get: function () { return stripeLifecycle_2.scanStripeMissingSubscriptionEvents; } });
Object.defineProperty(exports, "scanStripeWebhookIdempotency", { enumerable: true, get: function () { return stripeLifecycle_2.scanStripeWebhookIdempotency; } });
/**
 * High-confidence blocker ruleIds (error + confidence high, or legacy error without confidence).
 *
 * The Phase 0 target was "~12 or fewer". Phase 3 added five genuinely
 * high-precision blockers to the existing nine, landing at 14. Every entry here
 * must be near-certain when it fires; heuristic rules stay review/warning only.
 * Notably, the two auth-boundary "no visible guard" rules
 * (auth-server-action-no-check, auth-route-handler-unprotected) are error+medium
 * → review, NOT blockers, because public forms and public routes legitimately
 * run without auth — so they are deliberately absent from this list.
 *
 *  1. stripe-webhook-signature
 *  2. database-migration-safety
 *  3. supabase-rls
 *  4. supabase-service-role-leak
 *  5. public-secret
 *  6. stripe-secret-leak
 *  7. undocumented-env
 *  8. ai-llm-key-in-client
 *  9. database-connection-pooling (CLI)
 * 10. auth-service-role-bypass
 * 11. supabase-policy-permissive
 * 12. supabase-migration-auth-linked-no-rls
 * 13. stripe-live-key-in-dev
 * 14. vercel-edge-node-mismatch
 */
exports.HIGH_CONFIDENCE_BLOCKER_RULE_IDS = [
    'stripe-webhook-signature',
    'database-migration-safety',
    'supabase-rls',
    'supabase-service-role-leak',
    'public-secret',
    'stripe-secret-leak',
    'undocumented-env',
    'ai-llm-key-in-client',
    'database-connection-pooling',
    'auth-service-role-bypass',
    'supabase-policy-permissive',
    'supabase-migration-auth-linked-no-rls',
    'stripe-live-key-in-dev',
    'vercel-edge-node-mismatch',
];
/** Runs Phase 3 deeper-stack scanners over the supplied project sources. */
function runDeeperStackScans(sources, options = {}) {
    const { includeEdgeRuntime = true } = options;
    const findings = [];
    const sqlSources = sources.filter((source) => source.file.endsWith('.sql'));
    const codeSources = sources.filter((source) => /\.(?:js|ts|jsx|tsx)$/.test(source.file));
    const envSources = sources.filter((source) => /(?:^|[/\\])\.env(?:\.(?:local|development|dev|test|staging))?(?:$|[/\\])/.test(source.file.replace(/\\/g, '/')));
    for (const source of codeSources) {
        findings.push(...(0, authBoundary_1.scanServerActionAuth)(source.content, source.file).findings);
        findings.push(...(0, authBoundary_1.scanRouteHandlerAuth)(source.content, source.file).findings);
        findings.push(...(0, authBoundary_1.scanServiceRoleBypass)(source.content, source.file).findings);
        findings.push(...(0, stripeLifecycle_1.scanStripeWebhookIdempotency)(source.content, source.file).findings);
        findings.push(...(0, stripeLifecycle_1.scanStripeMissingSubscriptionEvents)(source.content, source.file).findings);
        if (includeEdgeRuntime) {
            findings.push(...scanEdgeRuntime(source.content, source.file).findings);
        }
        findings.push(...scanMaxDuration(source.content, source.file).findings);
    }
    for (const source of envSources) {
        findings.push(...(0, stripeLifecycle_1.scanStripeLiveKeyInDev)(source.content, source.file).findings);
    }
    if (sqlSources.length > 0) {
        findings.push(...(0, supabasePolicies_1.scanSupabaseDeepPolicies)(sqlSources).findings);
    }
    return result(findings);
}
var shipGate_1 = require("./shipGate");
Object.defineProperty(exports, "buildIssueGroups", { enumerable: true, get: function () { return shipGate_1.buildIssueGroups; } });
Object.defineProperty(exports, "buildShipGateReport", { enumerable: true, get: function () { return shipGate_1.buildShipGateReport; } });
Object.defineProperty(exports, "formatShipGateMarkdown", { enumerable: true, get: function () { return shipGate_1.formatShipGateMarkdown; } });
Object.defineProperty(exports, "formatShipGatePlainText", { enumerable: true, get: function () { return shipGate_1.formatShipGatePlainText; } });
Object.defineProperty(exports, "getFindingGroupKey", { enumerable: true, get: function () { return shipGate_1.getFindingGroupKey; } });
Object.defineProperty(exports, "isShipGateBlocked", { enumerable: true, get: function () { return shipGate_1.isShipGateBlocked; } });
Object.defineProperty(exports, "resolveGroupAction", { enumerable: true, get: function () { return shipGate_1.resolveGroupAction; } });
