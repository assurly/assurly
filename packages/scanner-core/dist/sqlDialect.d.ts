export type SqlDialect = 'postgres' | 'clickhouse' | 'unknown';
export interface SqlDialectInput {
    file: string;
    content: string;
}
/**
 * Classifies a .sql file so Postgres-only rules (RLS, policies, NOT NULL
 * ALTER) do not fire on ClickHouse. Unknown stays on the Postgres path —
 * that is the historical default for `db/migrations/*.sql`.
 */
export declare function detectSqlDialect(input: SqlDialectInput): SqlDialect;
/** True when Postgres-flavoured SQL rules should run on this source. */
export declare function isPostgresSqlSource(input: SqlDialectInput): boolean;
