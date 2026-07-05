"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.scanServerActionAuth = scanServerActionAuth;
exports.scanRouteHandlerAuth = scanRouteHandlerAuth;
exports.scanServiceRoleBypass = scanServiceRoleBypass;
exports.scanAuthBoundary = scanAuthBoundary;
const parser_1 = require("@babel/parser");
const result = (findings) => ({
    errorCount: findings.filter((finding) => finding.severity === 'error').length,
    warningCount: findings.filter((finding) => finding.severity === 'warning').length,
    findings,
});
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
function finding(ruleId, severity, confidence, file, line, message, suggestion) {
    return { ruleId, severity, confidence, file, line, message, suggestion };
}
const AUTH_GUARD_PATTERNS = [
    /\bgetServerSession\s*\(/,
    /\bauth\s*\(\s*\)/,
    /\bcurrentUser\s*\(/,
    /\brequireAuth\s*\(/,
    /\brequireUser\s*\(/,
    /\brequireSession\s*\(/,
    /\bgetSession\s*\(/,
    /\bgetSessionUser\s*\(/,
    /\bverifySession\s*\(/,
    /\brequireOrganizationMember\s*\(/,
    /\brequireRepositoryAccess\s*\(/,
    /\brequireScanAccess\s*\(/,
    /\brequireFindingAccess\s*\(/,
    /\bAuthenticationError\b/,
    /\bAuthorizationError\b/,
    /\bsupabase\.auth\.getUser\s*\(/,
    /\bcookies\s*\(\s*\)\.get\s*\(/,
    /\bheaders\s*\(\s*\)\.get\s*\(\s*['"]authorization['"]/i,
    /\bUnauthorized\b/,
    /\bstatus:\s*401\b/,
    /\bNextResponse\.json\([^)]*401/,
];
const SERVICE_ROLE_GUARD_PATTERNS = [
    ...AUTH_GUARD_PATTERNS,
    /\bgetSupabaseAdminConfig\s*\(/,
    /\bgetAdminDbAdapter\s*\(/,
    /\btrusted system operations\b/i,
    /\bCRON_SECRET\b/,
    /\bverifyCron\b/i,
    /\brequireAdmin\s*\(/,
    /\bisAdmin\s*\(/,
    /\bassertAdmin\b/i,
    /\bconstructEvent(?:Async)?\s*\(/,
    /\bwebhooks\.constructEvent/,
    /\bfrom\s+['"]server-only['"]/,
];
const MUTATION_PATTERNS = [
    /\.insert\s*\(/,
    /\.update\s*\(/,
    /\.delete\s*\(/,
    /\.upsert\s*\(/,
    /\.create\s*\(/,
    /\.save\s*\(/,
    /\.remove\s*\(/,
    /\bprisma\.[a-zA-Z_$]+\.(?:create|update|delete|upsert)\s*\(/,
    /\bINSERT\s+INTO\b/i,
    /\bUPDATE\s+[a-zA-Z0-9_."`]+\s+SET\b/i,
    /\bDELETE\s+FROM\b/i,
];
// A service-role KEY reference on its own is not dangerous — it appears in
// env-var declarations, test config, and even code that *detects* service_role
// leaks (e.g. our own runtime scanner does `role === 'service_role'`). The rule
// must only fire when the file actually CONSTRUCTS a Supabase client, so both a
// client-construction call AND a service-role key reference are required.
const SERVICE_ROLE_KEY_REFERENCE = /\b(?:SUPABASE_SERVICE_ROLE_KEY|serviceRoleKey)\b/;
const CLIENT_CONSTRUCTION = /\b(?:createClient|createServerClient)\s*\(/;
function isRouteHandlerFile(file) {
    const normalized = file.replace(/\\/g, '/').toLowerCase();
    return (normalized.endsWith('/route.ts') ||
        normalized.endsWith('/route.js') ||
        normalized.endsWith('/route.tsx') ||
        normalized.endsWith('/route.jsx'));
}
function isProtectedRoutePath(file) {
    const normalized = file.replace(/\\/g, '/').toLowerCase();
    // NB: do NOT include a bare `app` segment here — in the Next.js App Router
    // every route lives under `app/`, so matching it would treat every public
    // route (auth callbacks, webhooks, public features) as protected and fire on
    // all of them. Match only genuinely privileged areas.
    return (/\/(?:dashboard|admin|account|settings|profile|billing|members|orgs|organizations)\//.test(normalized) || /\/api\/(?:protected|private|admin|dashboard|account|billing|members)\//.test(normalized));
}
function hasUseServerDirective(content, ast) {
    const program = ast.program;
    if (program?.directives?.some((directive) => directive.value?.value === 'use server')) {
        return true;
    }
    return /['"]use server['"]/.test(content);
}
function hasMutation(content) {
    return MUTATION_PATTERNS.some((pattern) => pattern.test(content));
}
function hasAuthGuard(content) {
    return AUTH_GUARD_PATTERNS.some((pattern) => pattern.test(content));
}
function hasServiceRoleGuard(content) {
    return SERVICE_ROLE_GUARD_PATTERNS.some((pattern) => pattern.test(content));
}
function usesServiceRole(content) {
    return CLIENT_CONSTRUCTION.test(content) && SERVICE_ROLE_KEY_REFERENCE.test(content);
}
function scanServerActionAuth(content, file = 'actions.ts') {
    const findings = [];
    let ast;
    try {
        ast = parseCode(content);
    }
    catch {
        return result(findings);
    }
    if (!hasUseServerDirective(content, ast))
        return result(findings);
    if (!hasMutation(content))
        return result(findings);
    if (hasAuthGuard(content))
        return result(findings);
    return result([
        finding('auth-server-action-no-check', 'error', 
        // Heuristic → review, not a hard blocker: a mutating Server Action with no
        // visible guard is often a real auth gap, but public forms (contact,
        // waitlist) legitimately insert/create without auth, so this cannot be
        // high-confidence. Mirrors auth-route-handler-unprotected.
        'medium', file, 1, "Server Action ('use server') mutates data without an authentication or session guard.", 'Call requireUser(), getSession(), or an equivalent authorization check before persisting changes.'),
    ]);
}
function scanRouteHandlerAuth(content, file = 'route.ts') {
    const findings = [];
    if (!isRouteHandlerFile(file) || !isProtectedRoutePath(file)) {
        return result(findings);
    }
    let ast;
    try {
        ast = parseCode(content);
    }
    catch {
        return result(findings);
    }
    void ast;
    if (hasAuthGuard(content))
        return result(findings);
    return result([
        finding('auth-route-handler-unprotected', 'error', 'medium', file, 1, 'Route handler under a protected path has no session or authorization check.', 'Require an authenticated session (requireUser, getSession, or authorization helper) before handling the request.'),
    ]);
}
function scanServiceRoleBypass(content, file = 'server.ts') {
    const findings = [];
    const program = (() => {
        try {
            return parseCode(content).program;
        }
        catch {
            return undefined;
        }
    })();
    const isClient = program?.directives?.some((directive) => directive.value?.value === 'use client') ?? false;
    if (isClient)
        return result(findings);
    if (!usesServiceRole(content))
        return result(findings);
    if (hasServiceRoleGuard(content))
        return result(findings);
    return result([
        finding('auth-service-role-bypass', 'error', 'high', file, 1, 'Server code uses the Supabase service_role client without a clear authorization guard.', 'Restrict service_role usage to trusted system paths (requireUser, admin guard, or verified webhook/cron entry).'),
    ]);
}
function scanAuthBoundary(content, file = 'route.ts') {
    return result([
        ...scanServerActionAuth(content, file).findings,
        ...scanRouteHandlerAuth(content, file).findings,
        ...scanServiceRoleBypass(content, file).findings,
    ]);
}
