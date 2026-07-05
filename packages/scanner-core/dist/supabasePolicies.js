"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.scanSupabasePolicies = scanSupabasePolicies;
exports.scanSupabaseStorage = scanSupabaseStorage;
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
function scanAuthLinkedMigrationNoRls(sources) {
    const findings = [];
    const authLinkedTables = new Map();
    const rlsEnabled = new Set();
    for (const source of sources) {
        source.content.split(/\r?\n/).forEach((rawLine, index) => {
            const code = rawLine.replace(/--.*$/, '');
            const create = code.match(/create\s+table\s+(?:if\s+not\s+exists\s+)?([a-zA-Z0-9_."`'-]+)/i);
            if (create) {
                const table = normalizeTableName(create[1]);
                if (/references\s+auth\.users/i.test(code) ||
                    /\buser_id\b[\s\S]*references\s+auth\.users/i.test(code)) {
                    authLinkedTables.set(table, { file: source.file, line: index + 1 });
                }
            }
            const enabled = code.match(/alter\s+table\s+([a-zA-Z0-9_."`'-]+)\s+enable\s+row\s+level\s+security/i);
            if (enabled)
                rlsEnabled.add(normalizeTableName(enabled[1]));
        });
        const fullSql = stripSqlComments(source.content);
        const multiLineCreate = /create\s+table\s+(?:if\s+not\s+exists\s+)?([a-zA-Z0-9_."`'-]+)[\s\S]*?references\s+auth\.users/gi;
        let match;
        while ((match = multiLineCreate.exec(fullSql)) !== null) {
            const table = normalizeTableName(match[1]);
            const line = source.content.slice(0, match.index).split(/\r?\n/).length;
            authLinkedTables.set(table, { file: source.file, line: Math.max(1, line) });
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
