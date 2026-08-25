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

const MYSQL_PHPAUTH = [
  '-- Adminer 4.2.0 MySQL dump',
  '',
  'CREATE TABLE `attempts` (',
  '  `id` int(11) NOT NULL AUTO_INCREMENT,',
  "  `ip` char(39) NOT NULL DEFAULT '',",
  '  `expiredate` datetime NOT NULL,',
  '  PRIMARY KEY (`id`)',
  ') ENGINE=InnoDB DEFAULT CHARSET=utf8;',
  '',
  'CREATE TABLE `config` (',
  '  `setting` varchar(100) NOT NULL,',
  '  `value` varchar(255) DEFAULT NULL,',
  '  UNIQUE KEY `setting` (`setting`)',
  ') ENGINE=InnoDB DEFAULT CHARSET=utf8;',
  '',
  'CREATE TABLE `requests` (',
  '  `id` int(11) NOT NULL AUTO_INCREMENT,',
  '  `uid` int(11) NOT NULL,',
  '  PRIMARY KEY (`id`)',
  ') ENGINE=InnoDB DEFAULT CHARSET=utf8;',
  '',
  'CREATE TABLE `sessions` (',
  '  `id` int(11) NOT NULL AUTO_INCREMENT,',
  '  `uid` int(11) NOT NULL,',
  '  PRIMARY KEY (`id`)',
  ') ENGINE=InnoDB DEFAULT CHARSET=utf8;',
  '',
  'CREATE TABLE `users` (',
  '  `id` int(11) NOT NULL AUTO_INCREMENT,',
  '  `email` varchar(100) DEFAULT NULL,',
  '  PRIMARY KEY (`id`)',
  ') ENGINE=InnoDB DEFAULT CHARSET=utf8;',
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

  it('classifies a MySQL dump (PHPAuth-style) so Postgres rules do not run', () => {
    expect(detectSqlDialect({ file: 'database.sql', content: MYSQL_PHPAUTH })).toBe('mysql');
    expect(isPostgresSqlSource({ file: 'database.sql', content: MYSQL_PHPAUTH })).toBe(false);
  });

  it('classifies a minimal MySQL table by ENGINE=InnoDB and backticks', () => {
    expect(
      detectSqlDialect({
        file: 'schema.sql',
        content: 'CREATE TABLE `attempts` (`id` int) ENGINE=InnoDB;',
      }),
    ).toBe('mysql');
  });

  it('does not treat a Postgres migration that mentions engine as MySQL', () => {
    const postgresWithEngineWord = [
      'create table public.orders (',
      '  id uuid primary key,',
      '  search_engine text',
      ');',
      '-- the ranking engine writes into this table',
    ].join('\n');
    expect(
      detectSqlDialect({
        file: 'supabase/migrations/001.sql',
        content: postgresWithEngineWord,
      }),
    ).toBe('postgres');
    expect(
      detectSqlDialect({
        file: 'db/schema.sql',
        content: postgresWithEngineWord,
      }),
    ).toBe('unknown');
    expect(
      detectSqlDialect({
        file: 'db/schema.sql',
        content: postgresWithEngineWord,
      }),
    ).not.toBe('mysql');
  });
});
