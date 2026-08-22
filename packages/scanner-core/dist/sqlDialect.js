"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.detectSqlDialect = detectSqlDialect;
exports.isPostgresSqlSource = isPostgresSqlSource;
const CLICKHOUSE_ENGINE = /\bENGINE\s*=\s*(?:Replicated)?(?:Aggregating|Collapsing|Graphite|Replacing|Summing|VersionedCollapsing)?MergeTree\b|\bENGINE\s*=\s*(?:TinyLog|StripeLog|Log|Memory|Distributed)\b/i;
const CLICKHOUSE_TYPES = /\bLowCardinality\s*\(|\bDateTime64\s*\(|\bUInt(?:8|16|32|64)\b|\bNullable\s*\(/i;
const CLICKHOUSE_PARTITION = /\bPARTITION\s+BY\s+toYYYYMM\b/i;
function normalizePath(file) {
    return file.replace(/\\/g, '/').toLowerCase();
}
function looksLikeClickHouse(input) {
    if (normalizePath(input.file).includes('clickhouse'))
        return true;
    return (CLICKHOUSE_ENGINE.test(input.content) ||
        CLICKHOUSE_TYPES.test(input.content) ||
        CLICKHOUSE_PARTITION.test(input.content));
}
function looksLikePostgres(input) {
    return (/supabase/i.test(input.file) ||
        /supabase/i.test(input.content) ||
        /auth\.uid\(\)/i.test(input.content) ||
        /auth\.users\b/i.test(input.content) ||
        /create\s+policy\b/i.test(input.content) ||
        /enable\s+row\s+level\s+security/i.test(input.content));
}
/**
 * Classifies a .sql file so Postgres-only rules (RLS, policies, NOT NULL
 * ALTER) do not fire on ClickHouse. Unknown stays on the Postgres path —
 * that is the historical default for `db/migrations/*.sql`.
 */
function detectSqlDialect(input) {
    if (looksLikeClickHouse(input))
        return 'clickhouse';
    if (looksLikePostgres(input))
        return 'postgres';
    return 'unknown';
}
/** True when Postgres-flavoured SQL rules should run on this source. */
function isPostgresSqlSource(input) {
    return detectSqlDialect(input) !== 'clickhouse';
}
