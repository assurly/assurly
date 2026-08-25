export type SqlDialect = 'postgres' | 'clickhouse' | 'mysql' | 'unknown';

export interface SqlDialectInput {
  file: string;
  content: string;
}

const CLICKHOUSE_ENGINE =
  /\bENGINE\s*=\s*(?:Replicated)?(?:Aggregating|Collapsing|Graphite|Replacing|Summing|VersionedCollapsing)?MergeTree\b|\bENGINE\s*=\s*(?:TinyLog|StripeLog|Log|Memory|Distributed)\b/i;

const CLICKHOUSE_TYPES =
  /\bLowCardinality\s*\(|\bDateTime64\s*\(|\bUInt(?:8|16|32|64)\b|\bNullable\s*\(/i;

const CLICKHOUSE_PARTITION = /\bPARTITION\s+BY\s+toYYYYMM\b/i;

const MYSQL_DUMP_HEADER = /(?:^|\n)\s*--[^\n]*(?:MySQL|MariaDB)\s+dump/i;

const MYSQL_ENGINE = /\bENGINE\s*=\s*(?:InnoDB|MyISAM|MEMORY|ARCHIVE|CSV)\b/i;

const MYSQL_AUTO_INCREMENT = /\bAUTO_INCREMENT\b/i;

const MYSQL_CHARSET = /\bDEFAULT\s+CHARSET\s*=|\bCOLLATE\s*=\s*utf8mb4_/i;

const MYSQL_DISPLAY_WIDTH = /\b(?:tinyint|smallint|mediumint|int|integer|bigint)\s*\(\s*\d+\s*\)/i;

const POSTGRES_RULE_DIALECTS: readonly SqlDialect[] = ['postgres', 'unknown'];

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

function looksLikeMySQL(input: SqlDialectInput): boolean {
  return (
    MYSQL_DUMP_HEADER.test(input.content) ||
    MYSQL_ENGINE.test(input.content) ||
    MYSQL_AUTO_INCREMENT.test(input.content) ||
    MYSQL_CHARSET.test(input.content) ||
    MYSQL_DISPLAY_WIDTH.test(input.content) ||
    (/\bcreate\s+table\b/i.test(input.content) && /`[^`]+`/.test(input.content))
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
 * ALTER) do not fire on ClickHouse or MySQL. Unknown stays on the Postgres
 * path — that is the historical default for `db/migrations/*.sql`. ClickHouse
 * is checked first so mixed ClickHouse/MySQL engine signals stay ClickHouse.
 */
export function detectSqlDialect(input: SqlDialectInput): SqlDialect {
  if (looksLikeClickHouse(input)) return 'clickhouse';
  if (looksLikeMySQL(input)) return 'mysql';
  if (looksLikePostgres(input)) return 'postgres';
  return 'unknown';
}

/** True when Postgres-flavoured SQL rules should run on this source. */
export function isPostgresSqlSource(input: SqlDialectInput): boolean {
  return POSTGRES_RULE_DIALECTS.includes(detectSqlDialect(input));
}
