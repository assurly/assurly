import { describe, expect, it } from 'vitest';
import { detectSqlDialect, isPostgresSqlSource } from './sqlDialect';

const CLICKHOUSE_AI_LOGS = [
  'CREATE TABLE IF NOT EXISTS ai_logs (',
  '  id UInt64,',
  '  created_at DateTime64(3),',
  '  payload Nullable(String),',
  '  category LowCardinality(String)',
  ')',
  'ENGINE = MergeTree',
  'PARTITION BY toYYYYMM(created_at)',
  'ORDER BY (created_at, id);',
].join('\n');

describe('detectSqlDialect', () => {
  it('classifies ClickHouse by path even without engine syntax', () => {
    expect(
      detectSqlDialect({
        file: 'configs/clickhouse/migrations/001_create_ai_logs.sql',
        content: 'CREATE TABLE ai_logs (id Int64);',
      }),
    ).toBe('clickhouse');
  });

  it('classifies ClickHouse by ENGINE = MergeTree regardless of path', () => {
    expect(
      detectSqlDialect({
        file: 'db/migrations/001.sql',
        content: 'CREATE TABLE events (id UInt64) ENGINE = MergeTree ORDER BY id;',
      }),
    ).toBe('clickhouse');
  });

  it('classifies Supabase migrations as postgres', () => {
    expect(
      detectSqlDialect({
        file: 'supabase/migrations/001.sql',
        content: 'create table public.orders(id uuid);',
      }),
    ).toBe('postgres');
  });

  it('keeps ordinary db migrations as unknown so existing Postgres rules still run', () => {
    expect(
      detectSqlDialect({
        file: 'db/schema.sql',
        content: 'create table public.orders(id uuid);',
      }),
    ).toBe('unknown');
    expect(
      isPostgresSqlSource({
        file: 'db/schema.sql',
        content: 'create table public.orders(id uuid);',
      }),
    ).toBe(true);
  });

  it('prefers ClickHouse when both path and Postgres signals are present', () => {
    expect(
      detectSqlDialect({
        file: 'configs/clickhouse/migrations/001.sql',
        content: 'CREATE TABLE ai_logs (id UInt64) ENGINE = MergeTree;\n-- supabase leftover',
      }),
    ).toBe('clickhouse');
    expect(
      isPostgresSqlSource({
        file: 'configs/clickhouse/migrations/001.sql',
        content: CLICKHOUSE_AI_LOGS,
      }),
    ).toBe(false);
  });
});
