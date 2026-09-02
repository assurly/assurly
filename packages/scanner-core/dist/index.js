"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isAgentStackFile = exports.isAgentMcpConfigFile = exports.isAgentInstructionFile = exports.isHighConfidenceBlockerRuleId = exports.HIGH_CONFIDENCE_BLOCKER_RULE_IDS = exports.scanStripeWebhookIdempotencyForProject = exports.scanStripeWebhookIdempotency = exports.scanStripeMissingSubscriptionEvents = exports.scanStripeLiveKeyInDev = exports.scanStripeLifecycle = exports.scanSupabaseStorage = exports.scanSupabasePolicies = exports.scanSupabaseDeepPolicies = exports.scanAuthLinkedMigrationNoRls = exports.scanServiceRoleBypass = exports.scanServerActionAuth = exports.scanRouteHandlerAuth = exports.scanAuthBoundary = exports.scanAiRouteAuthz = exports.scanAiRateLimit = exports.scanAiPromptInjection = exports.scanAiPiiToModelContext = exports.scanAiLlmKeyLeak = exports.scanAiAppSecurity = exports.selectPackageManifestPaths = exports.detectStackFromManifests = exports.describeDetectedStack = exports.MAX_PACKAGE_MANIFESTS = exports.unanalyzedSourceFinding = exports.unanalyzedLanguageForPath = exports.unanalyzedLanguageCounts = exports.summarizeUnanalyzedSource = exports.isSecuritySurfacePath = exports.isAnalyzedSourceFile = exports.isAnalyzedCodeFile = exports.formatUnanalyzedLogLine = exports.UNANALYZED_SOURCE_LANGUAGES = exports.SCAN_LANGUAGE_COVERAGE_RULE_ID = exports.rankFilesByRelevance = exports.measureScanScopeTotals = exports.isTextScanSurface = exports.isScannableFile = exports.instantGateSurfaceFiles = exports.inferScanRoots = exports.getFileRelevanceScore = exports.formatScanScopeSummary = exports.buildScanScope = exports.INSTANT_GATE_MAX_FILES = exports.RLS_GENERIC_TABLE_LABEL = exports.RLS_SUPABASE_TABLE_LABEL = void 0;
exports.isAssurlyCanaryBody = exports.extractAssurlyCanaryToken = exports.containsAssurlyCanaryToken = exports.containsAssurlyCanaryCallbackPath = exports.ASSURLY_CANARY_PREFIX = exports.ASSURLY_CANARY_IN_TEXT = exports.ASSURLY_CANARY_ENV_KEY = exports.ASSURLY_CANARY_CALLBACK_PATH = exports.findNearestCorpusMatch = exports.damerauLevenshtein = exports.tokenizePackageName = exports.scopeOwnsBorrowedName = exports.parsePackageJsonDependencies = exports.isAbandonedShape = exports.getTopNpmPackageCorpus = exports.findBorrowedCorpusName = exports.evaluateNewDependencies = exports.evaluateDependencyProvenance = exports.diffAddedDependencies = exports.contiguousTokenRuns = exports.collectDependencyNames = exports.DEP_YOUNG_AGE_DAYS = exports.DEP_TYPOSQUAT_SUSPECT = exports.DEP_SLOPSQUAT_SUSPECT = exports.DEP_SCAN_CAPPED = exports.DEP_REGISTRY_UNAVAILABLE = exports.DEP_PROXIMITY_MAX_DISTANCE = exports.DEP_NONEXISTENT_PACKAGE = exports.DEP_NEW_UNVETTED = exports.DEP_LOW_DOWNLOADS = exports.DEP_DEFAULT_EVAL_CAP = exports.scanSupplyChain = exports.readIgnoreScriptsFromNpmrc = exports.parsePackageManagerNpmMajor = exports.packageNameFromLockKey = exports.isSupplyChainRuleId = exports.enginesNpmPermitsBelow12 = exports.classifyAllowScriptsKey = exports.SUPPLY_NPM_BELOW_V12 = exports.SUPPLY_NON_REGISTRY_DEPENDENCY = exports.SUPPLY_INSTALL_SCRIPTS_UNREVIEWED = exports.SUPPLY_CHAIN_RULE_IDS = exports.SUPPLY_ALLOWSCRIPTS_UNPINNED = exports.SUPPLY_ALLOWSCRIPTS_STALE = exports.SUPPLY_ALLOWSCRIPTS_INVALID = exports.SUPPLY_ALLOWSCRIPTS_IN_WORKSPACE = exports.scanAgentStack = exports.scanAgentMcpConfig = exports.scanAgentInstructionFile = exports.redactEnvKey = void 0;
exports.isPostgresSqlSource = exports.detectSqlDialect = exports.scanWorkspaceFiles = exports.scanTsconfigStrict = exports.scanHardcodedStripeSecrets = exports.scanGithubActionsIntegration = exports.githubActionsIntegrationMessage = exports.GITHUB_ACTIONS_MISSING_ASSURLY_MESSAGE = exports.GITHUB_ACTIONS_INIT_SUGGESTION = exports.GITHUB_ACTIONS_EXISTING_CI_MESSAGE = exports.parseGitIgnoreSources = exports.isGitIgnored = exports.isGitIgnorePath = exports.isAssurlyEnvExamplePath = exports.excludeGitIgnoredFiles = exports.resolveGroupAction = exports.isShipGateBlocked = exports.getFindingGroupKey = exports.formatShipGatePlainText = exports.formatShipGateMarkdown = exports.countCleanScannedFiles = exports.buildShipGateReport = exports.buildIssueGroups = exports.RLS_SCORE_GROUP_CAP = exports.BLOCKED_SCORE_CAP = exports.mergeCanaryPlantIntoEnvExample = exports.isAssurlyCanaryToken = exports.isAssurlyCanaryPlantLine = exports.isAssurlyCanaryMcpUrl = exports.isAssurlyCanaryEnvKey = void 0;
exports.isSupabaseRlsMessage = isSupabaseRlsMessage;
exports.subsumeRlsFindings = subsumeRlsFindings;
exports.selectFiles = selectFiles;
exports.incompleteScanFinding = incompleteScanFinding;
exports.scanStripeWebhook = scanStripeWebhook;
exports.scanRscDataLeaks = scanRscDataLeaks;
exports.isServerlessApiRouteFile = isServerlessApiRouteFile;
exports.scanDbConnectionPooling = scanDbConnectionPooling;
exports.scanColdStart = scanColdStart;
exports.scanEdgeRuntime = scanEdgeRuntime;
exports.scanMaxDuration = scanMaxDuration;
exports.scanSqlMigrations = scanSqlMigrations;
exports.scanSqlMigration = scanSqlMigration;
exports.scanSupabaseClientLeaks = scanSupabaseClientLeaks;
exports.isAppEnvSourceFile = isAppEnvSourceFile;
exports.collectProcessEnvKeysFromCode = collectProcessEnvKeysFromCode;
exports.proposeEnvExamplePath = proposeEnvExamplePath;
exports.resolveEnvExampleForPath = resolveEnvExampleForPath;
exports.collectTestOnlyEnvKeys = collectTestOnlyEnvKeys;
exports.scanEnvVariables = scanEnvVariables;
exports.runDeeperStackScans = runDeeperStackScans;
const parser_1 = require("@babel/parser");
const fileRelevance_1 = require("./fileRelevance");
Object.defineProperty(exports, "INSTANT_GATE_MAX_FILES", { enumerable: true, get: function () { return fileRelevance_1.INSTANT_GATE_MAX_FILES; } });
Object.defineProperty(exports, "buildScanScope", { enumerable: true, get: function () { return fileRelevance_1.buildScanScope; } });
Object.defineProperty(exports, "formatScanScopeSummary", { enumerable: true, get: function () { return fileRelevance_1.formatScanScopeSummary; } });
Object.defineProperty(exports, "getFileRelevanceScore", { enumerable: true, get: function () { return fileRelevance_1.getFileRelevanceScore; } });
Object.defineProperty(exports, "inferScanRoots", { enumerable: true, get: function () { return fileRelevance_1.inferScanRoots; } });
Object.defineProperty(exports, "instantGateSurfaceFiles", { enumerable: true, get: function () { return fileRelevance_1.instantGateSurfaceFiles; } });
Object.defineProperty(exports, "isScannableFile", { enumerable: true, get: function () { return fileRelevance_1.isScannableFile; } });
Object.defineProperty(exports, "isTextScanSurface", { enumerable: true, get: function () { return fileRelevance_1.isTextScanSurface; } });
Object.defineProperty(exports, "measureScanScopeTotals", { enumerable: true, get: function () { return fileRelevance_1.measureScanScopeTotals; } });
Object.defineProperty(exports, "rankFilesByRelevance", { enumerable: true, get: function () { return fileRelevance_1.rankFilesByRelevance; } });
const authBoundary_1 = require("./authBoundary");
const sqlDialect_1 = require("./sqlDialect");
const supabasePolicies_1 = require("./supabasePolicies");
const stripeLifecycle_1 = require("./stripeLifecycle");
const canaryToken_1 = require("./canaryToken");
const result = (findings) => ({
    errorCount: findings.filter((finding) => finding.severity === 'error').length,
    warningCount: findings.filter((finding) => finding.severity === 'warning').length,
    findings,
});
exports.RLS_SUPABASE_TABLE_LABEL = 'Supabase table';
exports.RLS_GENERIC_TABLE_LABEL = 'Database table';
function tableNameFromRlsMessage(message) {
    const match = message.match(/table '([^']+)'/i);
    return match?.[1] ?? null;
}
/** True when a `supabase-rls` message was emitted for a real Supabase stack. */
function isSupabaseRlsMessage(message) {
    return message.startsWith(`${exports.RLS_SUPABASE_TABLE_LABEL} '`);
}
/**
 * When both `supabase-rls` and `supabase-migration-auth-linked-no-rls` fire for
 * the same table, keep the richer auth-linked finding and drop the generic one.
 */
function subsumeRlsFindings(findings) {
    const authLinkedTables = new Set(findings
        .filter((finding) => finding.ruleId === 'supabase-migration-auth-linked-no-rls')
        .map((finding) => tableNameFromRlsMessage(finding.message))
        .filter((table) => Boolean(table)));
    if (authLinkedTables.size === 0)
        return [...findings];
    return findings.filter((finding) => {
        if (finding.ruleId !== 'supabase-rls')
            return true;
        const table = tableNameFromRlsMessage(finding.message);
        return !table || !authLinkedTables.has(table);
    });
}
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
/**
 * @param options.eligibleTotal Eligible files across the repository, measured on
 *   the full tree. The browser selects from a sample the server already capped,
 *   so `selection.total` describes that sample — and when the sample was read
 *   whole, `selection.complete` reports a truncated scan as complete.
 * @param options.eligibleTotalIsLowerBound Only part of the tree was fetched, so
 *   `eligibleTotal` is a floor. Say so rather than name a total nothing measured.
 */
function incompleteScanFinding(selection, options = {}) {
    const analyzed = selection.files.length;
    const eligible = Math.max(options.eligibleTotal ?? selection.total, analyzed);
    if (eligible <= analyzed)
        return null;
    const eligibleLabel = options.eligibleTotalIsLowerBound ? `at least ${eligible}` : `${eligible}`;
    return {
        ruleId: 'scan-completeness',
        severity: 'warning',
        message: `Scan is incomplete: analyzed ${analyzed} of ${eligibleLabel} eligible files (configured limit: ${selection.limit}).`,
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
function walkWithAncestors(node, ancestors, visit) {
    if (!node || typeof node !== 'object')
        return;
    const candidate = node;
    const isAst = typeof candidate.type === 'string';
    const nextAncestors = isAst ? [...ancestors, candidate] : ancestors;
    if (isAst)
        visit(candidate, ancestors);
    for (const [key, value] of Object.entries(candidate)) {
        if (key === 'loc' || key === 'start' || key === 'end' || key === 'extra')
            continue;
        if (Array.isArray(value)) {
            value.forEach((item) => walkWithAncestors(item, nextAncestors, visit));
        }
        else if (value && typeof value === 'object') {
            walkWithAncestors(value, nextAncestors, visit);
        }
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
        if (isClient && node.type === 'ImportDeclaration' && node.importKind !== 'type') {
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
const DB_POOL_CLASSES = new Set(['PrismaClient', 'Pool', 'Client', 'MongoClient']);
/** Next.js API route / Route Handler paths, including monorepo apps/<pkg>/src/app/api. */
function isServerlessApiRouteFile(filePath) {
    const normalized = filePath.replace(/\\/g, '/');
    return (/(?:^|\/)(?:src\/)?(?:app|pages)\/api\//.test(normalized) &&
        /\.(?:js|ts|jsx|tsx)$/.test(normalized));
}
function enclosingFunctionName(ancestors) {
    for (let index = ancestors.length - 1; index >= 0; index -= 1) {
        const node = ancestors[index];
        if (!node)
            continue;
        switch (node.type) {
            case 'FunctionDeclaration': {
                const id = node.id;
                return id?.name ?? 'anonymous function';
            }
            case 'FunctionExpression':
            case 'ArrowFunctionExpression': {
                const parent = ancestors[index - 1];
                if (parent?.type === 'VariableDeclarator') {
                    const id = parent.id;
                    if (id?.name)
                        return id.name;
                }
                return 'anonymous function';
            }
            case 'ClassMethod':
            case 'ClassPrivateMethod':
            case 'ObjectMethod': {
                const key = node.key;
                return key?.name ?? (typeof key?.value === 'string' ? key.value : 'anonymous function');
            }
            default:
                break;
        }
    }
    return null;
}
function scanDbConnectionPooling(content, file = 'route.ts') {
    if (!isServerlessApiRouteFile(file))
        return result([]);
    const findings = [];
    let ast;
    try {
        ast = parseCode(content);
    }
    catch {
        return result(findings);
    }
    walkWithAncestors(ast, [], (node, ancestors) => {
        if (node.type !== 'NewExpression')
            return;
        const callee = node.callee;
        const className = callee?.type === 'Identifier' ? String(callee.name) : null;
        if (!className || !DB_POOL_CLASSES.has(className))
            return;
        const functionName = enclosingFunctionName(ancestors);
        if (!functionName)
            return;
        findings.push({
            ruleId: 'database-connection-pooling',
            severity: 'error',
            confidence: 'high',
            file,
            line: lineOf(node),
            message: `Database client '${className}' is instantiated inside function '${functionName}' in a serverless API route. This will open a new database connection on every request and quickly exhaust your database connection pool.`,
            suggestion: `Move 'new ${className}()' outside the function scope (as a global singleton) or import it from a shared database helper file.`,
        });
    });
    return result(findings);
}
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
            ? node.declaration?.type === 'VariableDeclaration'
                ? node.declaration.declarations?.[0]
                : undefined
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
    const postgresSources = sources.filter((source) => (0, sqlDialect_1.isPostgresSqlSource)(source));
    const normalize = (name) => name
        .replace(/['"`]/g, '')
        .replace(/^public\./i, '')
        .trim();
    for (const source of postgresSources) {
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
    const hasSupabaseSignal = postgresSources.some((source) => /supabase/i.test(source.file) ||
        /supabase/i.test(source.content) ||
        /auth\.uid\(\)/i.test(source.content) ||
        /auth\.users\b/i.test(source.content));
    const tableLabel = hasSupabaseSignal ? exports.RLS_SUPABASE_TABLE_LABEL : exports.RLS_GENERIC_TABLE_LABEL;
    for (const [table, location] of created) {
        if (!rls.has(table) &&
            !['spatial_ref_sys', 'geography_columns', 'geometry_columns'].includes(table))
            findings.push({
                ruleId: 'supabase-rls',
                severity: hasSupabaseSignal ? 'error' : 'warning',
                confidence: hasSupabaseSignal ? 'high' : 'medium',
                file: location.file,
                line: location.line,
                message: `${tableLabel} '${table}' is created but Row-Level Security (RLS) is not enabled.`,
                suggestion: `Add SQL step: ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY;`,
            });
    }
    findings.push(...(0, supabasePolicies_1.scanSupabaseDeepPolicies)(postgresSources).findings);
    return result(subsumeRlsFindings(findings));
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
    // GitHub Actions / runner injected variables — not project secrets to document.
    'GITHUB_OUTPUT',
    'GITHUB_STEP_SUMMARY',
    'GITHUB_ENV',
    'GITHUB_PATH',
    'GITHUB_ACTION',
    'GITHUB_ACTIONS',
    'GITHUB_WORKSPACE',
    'GITHUB_EVENT_PATH',
    'GITHUB_EVENT_NAME',
    'GITHUB_RUN_ID',
    'GITHUB_RUN_NUMBER',
    'GITHUB_SHA',
    'GITHUB_REF',
    'GITHUB_REPOSITORY',
    'GITHUB_JOB',
    'GITHUB_WORKFLOW',
    'RUNNER_OS',
    'RUNNER_ARCH',
    'RUNNER_TEMP',
    'RUNNER_TOOL_CACHE',
    canaryToken_1.ASSURLY_CANARY_ENV_KEY,
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
/**
 * CLI env-docs surface: application source, not tooling packages (`packages/cli`).
 * Matches `packages/cli/src/rules/envRules.ts` path prefixes exactly.
 */
function isAppEnvSourceFile(filePath) {
    const normalized = filePath.replace(/\\/g, '/');
    if (!/\.(?:js|ts|jsx|tsx)$/.test(normalized))
        return false;
    return (normalized.startsWith('src/') ||
        normalized.startsWith('app/') ||
        normalized.startsWith('apps/') ||
        normalized.startsWith('pages/') ||
        normalized.startsWith('components/'));
}
function processEnvKeyFromNode(node) {
    if (node.type !== 'MemberExpression' && node.type !== 'OptionalMemberExpression')
        return null;
    const object = node.object;
    if (!object ||
        (object.type !== 'MemberExpression' && object.type !== 'OptionalMemberExpression')) {
        return null;
    }
    const processId = object.object;
    if (processId?.type !== 'Identifier' || processId.name !== 'process')
        return null;
    if (memberName(object) !== 'env')
        return null;
    const key = memberName(node);
    if (!key || !/^[A-Z0-9_]+$/.test(key))
        return null;
    return key;
}
function stripQuotedSpans(line) {
    return line.replace(/(['"`])(?:\\.|(?!\1).)*\1/g, ' ');
}
/**
 * `process.env.KEY` / `process.env['KEY']` from real code, never from string literals.
 */
function collectProcessEnvKeysFromCode(content) {
    try {
        const ast = parseCode(content);
        const found = [];
        walk(ast, (node) => {
            const key = processEnvKeyFromNode(node);
            if (key)
                found.push({ key, line: lineOf(node) ?? 1 });
        });
        return found;
    }
    catch {
        const found = [];
        content.split(/\r?\n/).forEach((line, index) => {
            const searchable = stripQuotedSpans(line);
            for (const match of searchable.matchAll(/process\.env\.([A-Z0-9_]+)/g)) {
                found.push({ key: match[1], line: index + 1 });
            }
        });
        return found;
    }
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
/**
 * Propose the package-local `.env.example` path for a code file when no ancestor
 * example exists. Preserves leading workspace prefixes (e.g. `shipready/`).
 */
function proposeEnvExamplePath(codePath) {
    const normalized = codePath.replace(/\\/g, '/');
    const packageMatch = normalized.match(/^((?:.*\/)?(?:apps|packages)\/[^/]+)\//);
    if (packageMatch?.[1]) {
        return `${packageMatch[1]}/.env.example`;
    }
    return '.env.example';
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
        for (const { key } of collectProcessEnvKeysFromCode(source.content)) {
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
        // Planted Assurly canaries are intentional — informational, never a leak.
        if ((0, canaryToken_1.isAssurlyCanaryPlantLine)(line)) {
            findings.push({
                ruleId: 'assurly-canary-planted',
                severity: 'warning',
                confidence: 'high',
                file: exampleFile,
                line: index + 1,
                message: 'Assurly canary token detected. This is an intentional tripwire, not a leaked credential.',
                suggestion: 'Keep the canary planted. If Assurly alerts on a fetch of this URL, rotate the real Stripe, Supabase, and GitHub secrets on this app — not the canary URL.',
            });
            return;
        }
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
function isEnvExamplePath(filePath) {
    return filePath.replace(/\\/g, '/').endsWith('.env.example');
}
function exampleHasCanaryPlant(content) {
    return content.split(/\r?\n/).some((line) => (0, canaryToken_1.isAssurlyCanaryPlantLine)(line));
}
/**
 * One warning per scan when at least one `.env.example` exists and none of them
 * plant a silent alarm. Never a blocker — the offline scanner cannot mint a
 * live callback URL.
 */
function pushMissingCanaryFinding(examples, findings) {
    const existing = examples.filter((example) => isEnvExamplePath(example.file) && example.content.trim().length > 0);
    if (existing.length === 0)
        return;
    if (existing.some((example) => exampleHasCanaryPlant(example.content)))
        return;
    const target = existing.find((example) => example.file.replace(/\\/g, '/') === '.env.example') ?? existing[0];
    findings.push({
        ruleId: 'assurly-canary-missing',
        severity: 'warning',
        confidence: 'high',
        file: target.file,
        line: 1,
        message: 'No Assurly silent alarm in .env.example. Plant ASSURLY_CANARY_URL so Assurly can alert if an attacker fetches stolen env.',
        suggestion: 'Add a silent alarm in Assurly (dashboard / MCP plant).',
    });
}
function scanEnvVariables(exampleContent, codeContent, exampleFile = '.env.example', codeFile = 'code.ts', options = {}) {
    const findings = [];
    const hasAllExamples = options.allExamples !== undefined;
    const resolvedExample = hasAllExamples
        ? resolveEnvExampleForPath(codeFile, options.allExamples ?? [])
        : null;
    // When callers pass allExamples (monorepo mode), never fall back to a
    // non-ancestor exampleFile — that steals apps/web/.env.example for packages/*.
    const activeExample = resolvedExample
        ? resolvedExample
        : hasAllExamples
            ? { file: proposeEnvExamplePath(codeFile), content: '' }
            : { file: exampleFile, content: exampleContent };
    const keys = parseExampleKeys(activeExample.content);
    if (hasAllExamples && (options.allExamples?.length ?? 0) > 0) {
        const scannedExampleFiles = new Set();
        for (const example of options.allExamples ?? []) {
            if (!example.file.endsWith('.env.example') || scannedExampleFiles.has(example.file)) {
                continue;
            }
            scannedExampleFiles.add(example.file);
            scanExampleFileSecrets(example.content, example.file, findings);
        }
        if (options.emitMissingCanary !== false) {
            pushMissingCanaryFinding(options.allExamples ?? [], findings);
        }
    }
    else if (!hasAllExamples) {
        scanExampleFileSecrets(exampleContent, exampleFile, findings);
        if (options.emitMissingCanary !== false) {
            pushMissingCanaryFinding([{ file: exampleFile, content: exampleContent }], findings);
        }
    }
    for (const { key, line } of collectProcessEnvKeysFromCode(codeContent)) {
        if (FRAMEWORK_ENV_KEYS.has(key))
            continue;
        if (options.testOnlyKeys?.has(key))
            continue;
        if (!isEnvKeyDocumented(key, keys)) {
            const docPath = activeExample.file;
            findings.push({
                ruleId: 'undocumented-env',
                // Hygiene / DX — not a deploy-safety blocker. Missing `.env.example`
                // docs fail the Phase 0 "30-second defend" test for hard blockers.
                severity: 'warning',
                confidence: 'high',
                file: codeFile,
                line,
                message: `Environment variable 'process.env.${key}' is used but not documented in '${docPath}'.`,
                suggestion: `Add ${key}= to ${docPath}.`,
            });
        }
    }
    return result(findings);
}
var languageCoverage_1 = require("./languageCoverage");
Object.defineProperty(exports, "SCAN_LANGUAGE_COVERAGE_RULE_ID", { enumerable: true, get: function () { return languageCoverage_1.SCAN_LANGUAGE_COVERAGE_RULE_ID; } });
Object.defineProperty(exports, "UNANALYZED_SOURCE_LANGUAGES", { enumerable: true, get: function () { return languageCoverage_1.UNANALYZED_SOURCE_LANGUAGES; } });
Object.defineProperty(exports, "formatUnanalyzedLogLine", { enumerable: true, get: function () { return languageCoverage_1.formatUnanalyzedLogLine; } });
Object.defineProperty(exports, "isAnalyzedCodeFile", { enumerable: true, get: function () { return languageCoverage_1.isAnalyzedCodeFile; } });
Object.defineProperty(exports, "isAnalyzedSourceFile", { enumerable: true, get: function () { return languageCoverage_1.isAnalyzedSourceFile; } });
Object.defineProperty(exports, "isSecuritySurfacePath", { enumerable: true, get: function () { return languageCoverage_1.isSecuritySurfacePath; } });
Object.defineProperty(exports, "summarizeUnanalyzedSource", { enumerable: true, get: function () { return languageCoverage_1.summarizeUnanalyzedSource; } });
Object.defineProperty(exports, "unanalyzedLanguageCounts", { enumerable: true, get: function () { return languageCoverage_1.unanalyzedLanguageCounts; } });
Object.defineProperty(exports, "unanalyzedLanguageForPath", { enumerable: true, get: function () { return languageCoverage_1.unanalyzedLanguageForPath; } });
Object.defineProperty(exports, "unanalyzedSourceFinding", { enumerable: true, get: function () { return languageCoverage_1.unanalyzedSourceFinding; } });
var stackDetect_1 = require("./stackDetect");
Object.defineProperty(exports, "MAX_PACKAGE_MANIFESTS", { enumerable: true, get: function () { return stackDetect_1.MAX_PACKAGE_MANIFESTS; } });
Object.defineProperty(exports, "describeDetectedStack", { enumerable: true, get: function () { return stackDetect_1.describeDetectedStack; } });
Object.defineProperty(exports, "detectStackFromManifests", { enumerable: true, get: function () { return stackDetect_1.detectStackFromManifests; } });
Object.defineProperty(exports, "selectPackageManifestPaths", { enumerable: true, get: function () { return stackDetect_1.selectPackageManifestPaths; } });
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
Object.defineProperty(exports, "scanStripeWebhookIdempotencyForProject", { enumerable: true, get: function () { return stripeLifecycle_2.scanStripeWebhookIdempotencyForProject; } });
var blockerAllowlist_1 = require("./blockerAllowlist");
Object.defineProperty(exports, "HIGH_CONFIDENCE_BLOCKER_RULE_IDS", { enumerable: true, get: function () { return blockerAllowlist_1.HIGH_CONFIDENCE_BLOCKER_RULE_IDS; } });
Object.defineProperty(exports, "isHighConfidenceBlockerRuleId", { enumerable: true, get: function () { return blockerAllowlist_1.isHighConfidenceBlockerRuleId; } });
var agentStack_1 = require("./agentStack");
Object.defineProperty(exports, "isAgentInstructionFile", { enumerable: true, get: function () { return agentStack_1.isAgentInstructionFile; } });
Object.defineProperty(exports, "isAgentMcpConfigFile", { enumerable: true, get: function () { return agentStack_1.isAgentMcpConfigFile; } });
Object.defineProperty(exports, "isAgentStackFile", { enumerable: true, get: function () { return agentStack_1.isAgentStackFile; } });
Object.defineProperty(exports, "redactEnvKey", { enumerable: true, get: function () { return agentStack_1.redactEnvKey; } });
Object.defineProperty(exports, "scanAgentInstructionFile", { enumerable: true, get: function () { return agentStack_1.scanAgentInstructionFile; } });
Object.defineProperty(exports, "scanAgentMcpConfig", { enumerable: true, get: function () { return agentStack_1.scanAgentMcpConfig; } });
Object.defineProperty(exports, "scanAgentStack", { enumerable: true, get: function () { return agentStack_1.scanAgentStack; } });
var supplyChain_1 = require("./supplyChain");
Object.defineProperty(exports, "SUPPLY_ALLOWSCRIPTS_IN_WORKSPACE", { enumerable: true, get: function () { return supplyChain_1.SUPPLY_ALLOWSCRIPTS_IN_WORKSPACE; } });
Object.defineProperty(exports, "SUPPLY_ALLOWSCRIPTS_INVALID", { enumerable: true, get: function () { return supplyChain_1.SUPPLY_ALLOWSCRIPTS_INVALID; } });
Object.defineProperty(exports, "SUPPLY_ALLOWSCRIPTS_STALE", { enumerable: true, get: function () { return supplyChain_1.SUPPLY_ALLOWSCRIPTS_STALE; } });
Object.defineProperty(exports, "SUPPLY_ALLOWSCRIPTS_UNPINNED", { enumerable: true, get: function () { return supplyChain_1.SUPPLY_ALLOWSCRIPTS_UNPINNED; } });
Object.defineProperty(exports, "SUPPLY_CHAIN_RULE_IDS", { enumerable: true, get: function () { return supplyChain_1.SUPPLY_CHAIN_RULE_IDS; } });
Object.defineProperty(exports, "SUPPLY_INSTALL_SCRIPTS_UNREVIEWED", { enumerable: true, get: function () { return supplyChain_1.SUPPLY_INSTALL_SCRIPTS_UNREVIEWED; } });
Object.defineProperty(exports, "SUPPLY_NON_REGISTRY_DEPENDENCY", { enumerable: true, get: function () { return supplyChain_1.SUPPLY_NON_REGISTRY_DEPENDENCY; } });
Object.defineProperty(exports, "SUPPLY_NPM_BELOW_V12", { enumerable: true, get: function () { return supplyChain_1.SUPPLY_NPM_BELOW_V12; } });
Object.defineProperty(exports, "classifyAllowScriptsKey", { enumerable: true, get: function () { return supplyChain_1.classifyAllowScriptsKey; } });
Object.defineProperty(exports, "enginesNpmPermitsBelow12", { enumerable: true, get: function () { return supplyChain_1.enginesNpmPermitsBelow12; } });
Object.defineProperty(exports, "isSupplyChainRuleId", { enumerable: true, get: function () { return supplyChain_1.isSupplyChainRuleId; } });
Object.defineProperty(exports, "packageNameFromLockKey", { enumerable: true, get: function () { return supplyChain_1.packageNameFromLockKey; } });
Object.defineProperty(exports, "parsePackageManagerNpmMajor", { enumerable: true, get: function () { return supplyChain_1.parsePackageManagerNpmMajor; } });
Object.defineProperty(exports, "readIgnoreScriptsFromNpmrc", { enumerable: true, get: function () { return supplyChain_1.readIgnoreScriptsFromNpmrc; } });
Object.defineProperty(exports, "scanSupplyChain", { enumerable: true, get: function () { return supplyChain_1.scanSupplyChain; } });
var dependencyProvenance_1 = require("./dependencyProvenance");
Object.defineProperty(exports, "DEP_DEFAULT_EVAL_CAP", { enumerable: true, get: function () { return dependencyProvenance_1.DEP_DEFAULT_EVAL_CAP; } });
Object.defineProperty(exports, "DEP_LOW_DOWNLOADS", { enumerable: true, get: function () { return dependencyProvenance_1.DEP_LOW_DOWNLOADS; } });
Object.defineProperty(exports, "DEP_NEW_UNVETTED", { enumerable: true, get: function () { return dependencyProvenance_1.DEP_NEW_UNVETTED; } });
Object.defineProperty(exports, "DEP_NONEXISTENT_PACKAGE", { enumerable: true, get: function () { return dependencyProvenance_1.DEP_NONEXISTENT_PACKAGE; } });
Object.defineProperty(exports, "DEP_PROXIMITY_MAX_DISTANCE", { enumerable: true, get: function () { return dependencyProvenance_1.DEP_PROXIMITY_MAX_DISTANCE; } });
Object.defineProperty(exports, "DEP_REGISTRY_UNAVAILABLE", { enumerable: true, get: function () { return dependencyProvenance_1.DEP_REGISTRY_UNAVAILABLE; } });
Object.defineProperty(exports, "DEP_SCAN_CAPPED", { enumerable: true, get: function () { return dependencyProvenance_1.DEP_SCAN_CAPPED; } });
Object.defineProperty(exports, "DEP_SLOPSQUAT_SUSPECT", { enumerable: true, get: function () { return dependencyProvenance_1.DEP_SLOPSQUAT_SUSPECT; } });
Object.defineProperty(exports, "DEP_TYPOSQUAT_SUSPECT", { enumerable: true, get: function () { return dependencyProvenance_1.DEP_TYPOSQUAT_SUSPECT; } });
Object.defineProperty(exports, "DEP_YOUNG_AGE_DAYS", { enumerable: true, get: function () { return dependencyProvenance_1.DEP_YOUNG_AGE_DAYS; } });
Object.defineProperty(exports, "collectDependencyNames", { enumerable: true, get: function () { return dependencyProvenance_1.collectDependencyNames; } });
Object.defineProperty(exports, "contiguousTokenRuns", { enumerable: true, get: function () { return dependencyProvenance_1.contiguousTokenRuns; } });
Object.defineProperty(exports, "diffAddedDependencies", { enumerable: true, get: function () { return dependencyProvenance_1.diffAddedDependencies; } });
Object.defineProperty(exports, "evaluateDependencyProvenance", { enumerable: true, get: function () { return dependencyProvenance_1.evaluateDependencyProvenance; } });
Object.defineProperty(exports, "evaluateNewDependencies", { enumerable: true, get: function () { return dependencyProvenance_1.evaluateNewDependencies; } });
Object.defineProperty(exports, "findBorrowedCorpusName", { enumerable: true, get: function () { return dependencyProvenance_1.findBorrowedCorpusName; } });
Object.defineProperty(exports, "getTopNpmPackageCorpus", { enumerable: true, get: function () { return dependencyProvenance_1.getTopNpmPackageCorpus; } });
Object.defineProperty(exports, "isAbandonedShape", { enumerable: true, get: function () { return dependencyProvenance_1.isAbandonedShape; } });
Object.defineProperty(exports, "parsePackageJsonDependencies", { enumerable: true, get: function () { return dependencyProvenance_1.parsePackageJsonDependencies; } });
Object.defineProperty(exports, "scopeOwnsBorrowedName", { enumerable: true, get: function () { return dependencyProvenance_1.scopeOwnsBorrowedName; } });
Object.defineProperty(exports, "tokenizePackageName", { enumerable: true, get: function () { return dependencyProvenance_1.tokenizePackageName; } });
var editDistance_1 = require("./editDistance");
Object.defineProperty(exports, "damerauLevenshtein", { enumerable: true, get: function () { return editDistance_1.damerauLevenshtein; } });
Object.defineProperty(exports, "findNearestCorpusMatch", { enumerable: true, get: function () { return editDistance_1.findNearestCorpusMatch; } });
var canaryToken_2 = require("./canaryToken");
Object.defineProperty(exports, "ASSURLY_CANARY_CALLBACK_PATH", { enumerable: true, get: function () { return canaryToken_2.ASSURLY_CANARY_CALLBACK_PATH; } });
Object.defineProperty(exports, "ASSURLY_CANARY_ENV_KEY", { enumerable: true, get: function () { return canaryToken_2.ASSURLY_CANARY_ENV_KEY; } });
Object.defineProperty(exports, "ASSURLY_CANARY_IN_TEXT", { enumerable: true, get: function () { return canaryToken_2.ASSURLY_CANARY_IN_TEXT; } });
Object.defineProperty(exports, "ASSURLY_CANARY_PREFIX", { enumerable: true, get: function () { return canaryToken_2.ASSURLY_CANARY_PREFIX; } });
Object.defineProperty(exports, "containsAssurlyCanaryCallbackPath", { enumerable: true, get: function () { return canaryToken_2.containsAssurlyCanaryCallbackPath; } });
Object.defineProperty(exports, "containsAssurlyCanaryToken", { enumerable: true, get: function () { return canaryToken_2.containsAssurlyCanaryToken; } });
Object.defineProperty(exports, "extractAssurlyCanaryToken", { enumerable: true, get: function () { return canaryToken_2.extractAssurlyCanaryToken; } });
Object.defineProperty(exports, "isAssurlyCanaryBody", { enumerable: true, get: function () { return canaryToken_2.isAssurlyCanaryBody; } });
Object.defineProperty(exports, "isAssurlyCanaryEnvKey", { enumerable: true, get: function () { return canaryToken_2.isAssurlyCanaryEnvKey; } });
Object.defineProperty(exports, "isAssurlyCanaryMcpUrl", { enumerable: true, get: function () { return canaryToken_2.isAssurlyCanaryMcpUrl; } });
Object.defineProperty(exports, "isAssurlyCanaryPlantLine", { enumerable: true, get: function () { return canaryToken_2.isAssurlyCanaryPlantLine; } });
Object.defineProperty(exports, "isAssurlyCanaryToken", { enumerable: true, get: function () { return canaryToken_2.isAssurlyCanaryToken; } });
Object.defineProperty(exports, "mergeCanaryPlantIntoEnvExample", { enumerable: true, get: function () { return canaryToken_2.mergeCanaryPlantIntoEnvExample; } });
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
        findings.push(...(0, stripeLifecycle_1.scanStripeMissingSubscriptionEvents)(source.content, source.file).findings);
        if (includeEdgeRuntime) {
            findings.push(...scanEdgeRuntime(source.content, source.file).findings);
        }
        findings.push(...scanMaxDuration(source.content, source.file).findings);
    }
    findings.push(...(0, stripeLifecycle_1.scanStripeWebhookIdempotencyForProject)(codeSources).findings);
    for (const source of envSources) {
        findings.push(...(0, stripeLifecycle_1.scanStripeLiveKeyInDev)(source.content, source.file).findings);
    }
    const postgresSqlSources = sqlSources.filter((source) => (0, sqlDialect_1.isPostgresSqlSource)(source));
    if (postgresSqlSources.length > 0) {
        findings.push(...(0, supabasePolicies_1.scanSupabaseDeepPolicies)(postgresSqlSources).findings);
    }
    return result(findings);
}
var shipGate_1 = require("./shipGate");
Object.defineProperty(exports, "BLOCKED_SCORE_CAP", { enumerable: true, get: function () { return shipGate_1.BLOCKED_SCORE_CAP; } });
Object.defineProperty(exports, "RLS_SCORE_GROUP_CAP", { enumerable: true, get: function () { return shipGate_1.RLS_SCORE_GROUP_CAP; } });
Object.defineProperty(exports, "buildIssueGroups", { enumerable: true, get: function () { return shipGate_1.buildIssueGroups; } });
Object.defineProperty(exports, "buildShipGateReport", { enumerable: true, get: function () { return shipGate_1.buildShipGateReport; } });
Object.defineProperty(exports, "countCleanScannedFiles", { enumerable: true, get: function () { return shipGate_1.countCleanScannedFiles; } });
Object.defineProperty(exports, "formatShipGateMarkdown", { enumerable: true, get: function () { return shipGate_1.formatShipGateMarkdown; } });
Object.defineProperty(exports, "formatShipGatePlainText", { enumerable: true, get: function () { return shipGate_1.formatShipGatePlainText; } });
Object.defineProperty(exports, "getFindingGroupKey", { enumerable: true, get: function () { return shipGate_1.getFindingGroupKey; } });
Object.defineProperty(exports, "isShipGateBlocked", { enumerable: true, get: function () { return shipGate_1.isShipGateBlocked; } });
Object.defineProperty(exports, "resolveGroupAction", { enumerable: true, get: function () { return shipGate_1.resolveGroupAction; } });
var gitIgnore_1 = require("./gitIgnore");
Object.defineProperty(exports, "excludeGitIgnoredFiles", { enumerable: true, get: function () { return gitIgnore_1.excludeGitIgnoredFiles; } });
Object.defineProperty(exports, "isAssurlyEnvExamplePath", { enumerable: true, get: function () { return gitIgnore_1.isAssurlyEnvExamplePath; } });
Object.defineProperty(exports, "isGitIgnorePath", { enumerable: true, get: function () { return gitIgnore_1.isGitIgnorePath; } });
Object.defineProperty(exports, "isGitIgnored", { enumerable: true, get: function () { return gitIgnore_1.isGitIgnored; } });
Object.defineProperty(exports, "parseGitIgnoreSources", { enumerable: true, get: function () { return gitIgnore_1.parseGitIgnoreSources; } });
var workspaceScan_1 = require("./workspaceScan");
Object.defineProperty(exports, "GITHUB_ACTIONS_EXISTING_CI_MESSAGE", { enumerable: true, get: function () { return workspaceScan_1.GITHUB_ACTIONS_EXISTING_CI_MESSAGE; } });
Object.defineProperty(exports, "GITHUB_ACTIONS_INIT_SUGGESTION", { enumerable: true, get: function () { return workspaceScan_1.GITHUB_ACTIONS_INIT_SUGGESTION; } });
Object.defineProperty(exports, "GITHUB_ACTIONS_MISSING_ASSURLY_MESSAGE", { enumerable: true, get: function () { return workspaceScan_1.GITHUB_ACTIONS_MISSING_ASSURLY_MESSAGE; } });
Object.defineProperty(exports, "githubActionsIntegrationMessage", { enumerable: true, get: function () { return workspaceScan_1.githubActionsIntegrationMessage; } });
Object.defineProperty(exports, "scanGithubActionsIntegration", { enumerable: true, get: function () { return workspaceScan_1.scanGithubActionsIntegration; } });
Object.defineProperty(exports, "scanHardcodedStripeSecrets", { enumerable: true, get: function () { return workspaceScan_1.scanHardcodedStripeSecrets; } });
Object.defineProperty(exports, "scanTsconfigStrict", { enumerable: true, get: function () { return workspaceScan_1.scanTsconfigStrict; } });
Object.defineProperty(exports, "scanWorkspaceFiles", { enumerable: true, get: function () { return workspaceScan_1.scanWorkspaceFiles; } });
var sqlDialect_2 = require("./sqlDialect");
Object.defineProperty(exports, "detectSqlDialect", { enumerable: true, get: function () { return sqlDialect_2.detectSqlDialect; } });
Object.defineProperty(exports, "isPostgresSqlSource", { enumerable: true, get: function () { return sqlDialect_2.isPostgresSqlSource; } });
