export type SqlDialect = 'postgres' | 'clickhouse' | 'unknown';

export interface SqlDialectInput {
  file: string;
  content: string;
}

const CLICKHOUSE_ENGINE =
  /\bENGINE\s*=\s*(?:Replicated)?(?:Aggregating|Collapsing|Graphite|Replacing|Summing|VersionedCollapsing)?MergeTree\b|\bENGINE\s*=\s*(?:TinyLog|StripeLog|Log|Memory|Distributed)\b/i;

const CLICKHOUSE_TYPES =
  /\bLowCardinality\s*\(|\bDateTime64\s*\(|\bUInt(?:8|16|32|64)\b|\bNullable\s*\(/i;

const CLICKHOUSE_PARTITION = /\bPARTITION\s+BY\s+toYYYYMM\b/i;

function normalizePath(file: string): string {
  return file.replace(/\\/g, '/').toLowerCase();
}

function looksLikeClickHouse(input: SqlDialectInput): boolean {
  if (normalizePath(input.file).includes('clickhouse')) return true;
  return (
    CLICKHOUSE_ENGINE.test(input.content) ||
    CLICKHOUSE_TYPES.test(input.content) ||
    CLICKHOUSE_PARTITION.test(input.content)
  );
}

function looksLikePostgres(input: SqlDialectInput): boolean {
  return (
    /supabase/i.test(input.file) ||
    /supabase/i.test(input.content) ||
    /auth\.uid\(\)/i.test(input.content) ||
    /auth\.users\b/i.test(input.content) ||
    /create\s+policy\b/i.test(input.content) ||
    /enable\s+row\s+level\s+security/i.test(input.content)
  );
}

/**
 * Classifies a .sql file so Postgres-only rules (RLS, policies, NOT NULL
 * ALTER) do not fire on ClickHouse. Unknown stays on the Postgres path —
 * that is the historical default for `db/migrations/*.sql`.
 */
export function detectSqlDialect(input: SqlDialectInput): SqlDialect {
  if (looksLikeClickHouse(input)) return 'clickhouse';
  if (looksLikePostgres(input)) return 'postgres';
  return 'unknown';
}

/** True when Postgres-flavoured SQL rules should run on this source. */
export function isPostgresSqlSource(input: SqlDialectInput): boolean {
  return detectSqlDialect(input) !== 'clickhouse';
}
