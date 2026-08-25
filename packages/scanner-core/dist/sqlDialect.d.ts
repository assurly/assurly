export type SqlDialect = 'postgres' | 'clickhouse' | 'mysql' | 'unknown';
export interface SqlDialectInput {
    file: string;
    content: string;
}
/**
 * Classifies a .sql file so Postgres-only rules (RLS, policies, NOT NULL
 * ALTER) do not fire on ClickHouse or MySQL. Unknown stays on the Postgres
 * path — that is the historical default for `db/migrations/*.sql`. ClickHouse
 * is checked first so mixed ClickHouse/MySQL engine signals stay ClickHouse.
 */
export declare function detectSqlDialect(input: SqlDialectInput): SqlDialect;
/** True when Postgres-flavoured SQL rules should run on this source. */
export declare function isPostgresSqlSource(input: SqlDialectInput): boolean;
