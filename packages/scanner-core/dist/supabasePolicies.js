"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.scanSupabasePolicies = scanSupabasePolicies;
exports.scanSupabaseStorage = scanSupabaseStorage;
exports.rlsEnabledStatements = rlsEnabledStatements;
exports.scanAuthLinkedMigrationNoRls = scanAuthLinkedMigrationNoRls;
exports.scanSupabaseDeepPolicies = scanSupabaseDeepPolicies;
const result = (findings) => ({
    errorCount: findings.filter((finding) => finding.severity === 'error').length,
    warningCount: findings.filter((finding) => finding.severity === 'warning').length,
    findings,
});
function normalizeTableName(name) {
    return name
        .replace(/['"`]/g, '')
        .replace(/^public\./i, '')
        .trim();
}
function stripSqlComments(content) {
    return content.replace(/--[^\n]*/g, ' ');
}
function isScopedPolicy(clause) {
    return /\bauth\.uid\s*\(\s*\)/i.test(clause) || /\bauth\.jwt\s*\(\s*\)/i.test(clause);
}
function scanSupabasePolicies(content, file = 'policy.sql') {
    const findings = [];
    const sql = stripSqlComments(content);
    const policyChunks = sql
        .split(/(?=create\s+policy\b)/i)
        .filter((chunk) => /^create\s+policy\b/i.test(chunk.trim()));
    for (const chunk of policyChunks) {
        const tableMatch = chunk.match(/create\s+policy\s+["'`]?[^"'`;]+["'`]?\s+on\s+([a-zA-Z0-9_."`'-]+)/i);
        if (!tableMatch)
            continue;
        const table = normalizeTableName(tableMatch[1]);
        const usingMatch = chunk.match(/using\s*\(([^)]*)\)/i);
        if (!usingMatch)
            continue;
        const usingBody = usingMatch[1].replace(/\s+/g, '').toLowerCase();
        if (usingBody !== 'true')
            continue;
        if (isScopedPolicy(chunk))
            continue;
        const offset = sql.indexOf(chunk);
        const line = offset >= 0 ? sql.slice(0, offset).split(/\r?\n/).length : 1;
        findings.push({
            ruleId: 'supabase-policy-permissive',
            severity: 'error',
            confidence: 'high',
            file,
            line: Math.max(1, line),
            message: `RLS policy on '${table}' uses USING (true) and is effectively open to everyone.`,
            suggestion: 'Replace USING (true) with a scoped predicate such as auth.uid() = user_id before shipping.',
        });
    }
    return result(findings);
}
function scanSupabaseStorage(content, file = 'storage.sql') {
    const findings = [];
    const sql = stripSqlComments(content);
    sql.split(/\r?\n/).forEach((rawLine, index) => {
        const line = rawLine.trim();
        if (!line)
            return;
        const mentionsStorageBucket = /insert\s+into\s+storage\.buckets/i.test(line) || /create\s+bucket/i.test(line);
        const marksPublic = /\bpublic\b\s*,?\s*true/i.test(line) ||
            /\(\s*[^)]*\bpublic\b[^)]*\)\s*values\s*\([^)]*,\s*true\s*\)/i.test(line);
        if (mentionsStorageBucket && marksPublic) {
            findings.push({
                ruleId: 'supabase-storage-public-default',
                severity: 'warning',
                confidence: 'high',
                file,
                line: index + 1,
                message: 'Storage bucket is created as public by default.',
                suggestion: 'Create buckets as private and expose files through signed URLs or scoped storage policies.',
            });
        }
    });
    return result(findings);
}
/** Comments blanked to spaces, so every offset and line number still matches the file. */
function maskSqlComments(content) {
    return content
        .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, ' '))
        .replace(/--[^\n]*/g, (comment) => ' '.repeat(comment.length));
}
const TABLE_NAME = String.raw `([a-zA-Z0-9_."\`'-]+)`;
// The reference must sit in the same statement: never past a `;` or into the
// next CREATE TABLE, or an unrelated table inherits its neighbour's auth link.
const AUTH_LINKED_CREATE = new RegExp(String.raw `create\s+table\s+(?:if\s+not\s+exists\s+)?${TABLE_NAME}(?:(?!create\s+table)[^;])*?\breferences\s+auth\.users\b`, 'gi');
const ENABLE_RLS = new RegExp(String.raw `alter\s+table\s+(?:if\s+exists\s+)?(?:only\s+)?${TABLE_NAME}\s+enable\s+row\s+level\s+security`, 'gi');
/**
 * Tables a migration enables RLS on, with the line of each ALTER TABLE — also
 * when the statement is formatted across lines (`alter table x` / `enable row
 * level security;`). Names come back raw; callers normalise them their way.
 */
function rlsEnabledStatements(content) {
    const sql = maskSqlComments(content);
    return [...sql.matchAll(ENABLE_RLS)].map((match) => ({
        table: match[1],
        line: sql.slice(0, match.index).split(/\r?\n/).length,
    }));
}
function scanAuthLinkedMigrationNoRls(sources) {
    const findings = [];
    const authLinkedTables = new Map();
    const rlsEnabled = new Set();
    for (const source of sources) {
        const sql = maskSqlComments(source.content);
        for (const match of sql.matchAll(AUTH_LINKED_CREATE)) {
            const line = sql.slice(0, match.index).split(/\r?\n/).length;
            authLinkedTables.set(normalizeTableName(match[1]), { file: source.file, line });
        }
    }
    for (const source of sources) {
        for (const { table } of rlsEnabledStatements(source.content)) {
            rlsEnabled.add(normalizeTableName(table));
        }
    }
    for (const [table, location] of authLinkedTables) {
        if (rlsEnabled.has(table))
            continue;
        findings.push({
            ruleId: 'supabase-migration-auth-linked-no-rls',
            severity: 'error',
            confidence: 'high',
            file: location.file,
            line: location.line,
            message: `Table '${table}' references auth.users but Row-Level Security (RLS) is not enabled.`,
            suggestion: `Add: ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY; and scoped policies using auth.uid().`,
        });
    }
    return result(findings);
}
function scanSupabaseDeepPolicies(sources) {
    const findings = [];
    for (const source of sources) {
        findings.push(...scanSupabasePolicies(source.content, source.file).findings);
        findings.push(...scanSupabaseStorage(source.content, source.file).findings);
    }
    findings.push(...scanAuthLinkedMigrationNoRls(sources).findings);
    return result(findings);
}
