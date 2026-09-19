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
    // A `secureRoute` wrapper only counts as a guard when it actually authenticates
    // the caller — `auth: 'none'` and `auth: 'optional'` do not.
    /\bauth:\s*['"](?:required|apiKey)['"]/,
];
const CRON_GUARD_PATTERNS = [/\bCRON_SECRET\b/, /\bverifyCron\b/i];
const STRIPE_WEBHOOK_PATTERNS = [/\bconstructEvent(?:Async)?\s*\(/, /\bwebhooks\.constructEvent/];
const SERVICE_ROLE_GUARD_PATTERNS = [
    ...AUTH_GUARD_PATTERNS,
    /\bgetSupabaseAdminConfig\s*\(/,
    /\bgetAdminDbAdapter\s*\(/,
    /\btrusted system operations\b/i,
    ...CRON_GUARD_PATTERNS,
    /\brequireAdmin\s*\(/,
    /\bisAdmin\s*\(/,
    /\bassertAdmin\b/i,
    ...STRIPE_WEBHOOK_PATTERNS,
    /\bfrom\s+['"]server-only['"]/,
];
// A provider webhook authenticates its caller — and validates its body — by
// checking a signature over the raw payload. Reading `request.text()` there is
// the correct thing to do, not an unvalidated read.
const SIGNATURE_VERIFICATION_PATTERNS = [
    ...STRIPE_WEBHOOK_PATTERNS,
    /x-hub-signature/i,
    /\bsvix\b/i,
    /\bverifySignature\s*\(/,
    /\btimingSafeEqual\s*\(/,
];
// Entry points that legitimately mutate without a session: the caller is
// authenticated by a signature, a provider callback, or a cron secret rather
// than by a logged-in user.
const PUBLIC_MUTATION_PATTERNS = [...SIGNATURE_VERIFICATION_PATTERNS, ...CRON_GUARD_PATTERNS];
const PUBLIC_MUTATION_PATH_PATTERNS = [/\/auth\/callback(?:\/|$)/, /\/api\/auth\//];
const REQUEST_BODY_READ_PATTERNS = [
    /\b(?:request|req)\.(?:json|formData|text)\s*\(/,
    /\b(?:request|req)\.body\b/,
];
const SCHEMA_VALIDATION_PATTERNS = [
    /\.(?:parse|safeParse|parseAsync)\s*\(/,
    /\bz\.object\b/,
    /\byup\./,
    /\bvalibot\b/,
    /\bjoi\./,
    /\bajv\b/,
];
const HTTP_HANDLER_EXPORTS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']);
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
function isPublicMutationRoute(content, file) {
    const normalized = file.replace(/\\/g, '/').toLowerCase();
    return (PUBLIC_MUTATION_PATTERNS.some((pattern) => pattern.test(content)) ||
        PUBLIC_MUTATION_PATH_PATTERNS.some((pattern) => pattern.test(normalized)));
}
function readsRequestBody(content) {
    return REQUEST_BODY_READ_PATTERNS.some((pattern) => pattern.test(content));
}
function hasSchemaValidation(content) {
    // `JSON.parse` decodes; it validates nothing. Blank it out so the generic
    // `.parse(` pattern cannot mistake it for a schema call.
    const withoutJsonParse = content.replace(/\bJSON\.parse\s*\(/g, '');
    return SCHEMA_VALIDATION_PATTERNS.some((pattern) => pattern.test(withoutJsonParse));
}
function hasSignatureVerification(content) {
    return SIGNATURE_VERIFICATION_PATTERNS.some((pattern) => pattern.test(content));
}
/** Line of the first exported HTTP handler, so findings point at the entry point. */
function handlerExportLine(ast) {
    let earliest;
    walk(ast, (node) => {
        if (node.type !== 'ExportNamedDeclaration')
            return;
        const declaration = node.declaration;
        if (!declaration)
            return;
        const named = declaration.type === 'VariableDeclaration'
            ? (declaration.declarations ?? [])
            : [declaration];
        const exportsHandler = named.some((candidate) => {
            const id = candidate.id;
            return typeof id?.name === 'string' && HTTP_HANDLER_EXPORTS.has(id.name);
        });
        if (!exportsHandler)
            return;
        const line = lineOf(node);
        if (line !== undefined && (earliest === undefined || line < earliest))
            earliest = line;
    });
    return earliest ?? 1;
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
    if (!isRouteHandlerFile(file))
        return result(findings);
    let ast;
    try {
        ast = parseCode(content);
    }
    catch {
        return result(findings);
    }
    const line = handlerExportLine(ast);
    const guarded = hasAuthGuard(content);
    if (isProtectedRoutePath(file) && !guarded) {
        findings.push(finding('auth-route-handler-unprotected', 'error', 'medium', file, line, 'Route handler under a protected path has no session or authorization check.', 'Require an authenticated session (requireUser, getSession, or authorization helper) before handling the request.'));
    }
    if (hasMutation(content) && !guarded && !isPublicMutationRoute(content, file)) {
        findings.push(finding('auth-route-handler-mutates-unguarded', 'error', 
        // Heuristic → review, not a hard blocker: public forms (contact,
        // waitlist) legitimately write without a session, so a mutating route
        // with no visible guard cannot be high-confidence.
        'medium', file, line, 'Route handler writes to the database without an authentication or session guard.', 'Require an authenticated session (requireUser, getSession, or an authorization helper) before persisting changes, or verify a webhook signature if the caller is a provider.'));
    }
    if (readsRequestBody(content) &&
        !hasSchemaValidation(content) &&
        !hasSignatureVerification(content)) {
        findings.push(finding('api-route-unvalidated-input', 'warning', 'medium', file, line, 'Route handler reads the request body without validating it against a schema.', 'Parse the body with a schema (zod, yup, valibot, joi) and reject invalid input before using it.'));
    }
    return result(findings);
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
