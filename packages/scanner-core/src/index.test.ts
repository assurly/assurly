import { describe, expect, it } from 'vitest';
import {
  collectTestOnlyEnvKeys,
  incompleteScanFinding,
  isAppEnvSourceFile,
  isSupabaseRlsMessage,
  proposeEnvExamplePath,
  resolveEnvExampleForPath,
  RLS_GENERIC_TABLE_LABEL,
  RLS_SUPABASE_TABLE_LABEL,
  scanEdgeRuntime,
  scanEnvVariables,
  scanMaxDuration,
  scanRscDataLeaks,
  scanSqlMigrations,
  scanStripeWebhook,
  scanSupabaseClientLeaks,
  selectFiles,
} from './index';

describe('shared scanner core', () => {
  it('uses the AST instead of comments to verify Stripe signatures', () => {
    const code = `import Stripe from 'stripe';\n// stripe.webhooks.constructEvent(body, sig, secret)\nexport async function POST(request: Request) { await request.json(); }`;
    expect(scanStripeWebhook(code, 'app/api/webhook/route.ts').errorCount).toBe(1);
  });

  it('does not flag ordinary Stripe checkout code as a webhook', () => {
    const code = `import Stripe from 'stripe';\nexport async function POST(request: Request) { return request.json(); }`;
    expect(scanStripeWebhook(code, 'app/api/stripe/checkout/route.ts').findings).toEqual([]);
  });

  it('accepts real constructEventAsync verification', () => {
    const code = `import Stripe from 'stripe';\nstripe.webhooks.constructEventAsync(raw, signature, secret);`;
    expect(scanStripeWebhook(code, 'webhook.ts').findings).toEqual([]);
  });

  it('detects multiline client imports through the AST', () => {
    const code = `'use client';\nimport {\n PrismaClient\n} from '@prisma/client';`;
    expect(scanRscDataLeaks(code).errorCount).toBe(1);
  });

  it('marks configured file truncation as incomplete', () => {
    const selection = selectFiles(['a', 'b', 'c'], 2);
    expect(selection.complete).toBe(false);
    expect(incompleteScanFinding(selection)?.message).toContain('2 of 3');
  });

  /**
   * The browser selects from a sample the server already capped, so the
   * selection describes the sample. Counting eligible files from it told the
   * user a truncated scan had read almost everything.
   */
  it('counts eligible files across the repository, not the sample it received', () => {
    const selection = selectFiles(['a', 'b', 'c'], 2);
    expect(incompleteScanFinding(selection, { eligibleTotal: 4213 })?.message).toContain(
      '2 of 4213',
    );
  });

  it('still reports incompleteness when the sample was scanned whole', () => {
    const selection = selectFiles(['a', 'b'], 2);
    expect(selection.complete).toBe(true);
    // Unaided this is silent — the sample was fully read, so nothing looks wrong.
    expect(incompleteScanFinding(selection)).toBeNull();
    expect(incompleteScanFinding(selection, { eligibleTotal: 4213 })?.message).toContain(
      '2 of 4213',
    );
  });

  it('stays silent when the repository really was read in full', () => {
    const selection = selectFiles(['a', 'b'], 2);
    expect(incompleteScanFinding(selection, { eligibleTotal: 2 })).toBeNull();
  });

  it('uses AST exports and imports for Edge compatibility', () => {
    const code = `import { readFile } from\n'node:fs';\nexport const runtime = 'edge';`;
    const scan = scanEdgeRuntime(code, 'app/api/route.ts');
    expect(scan.errorCount).toBe(1);
    expect(scan.findings[0]).toMatchObject({
      ruleId: 'vercel-edge-node-mismatch',
      confidence: 'high',
    });
  });

  it('warns on long-running routes missing maxDuration', () => {
    const code = [
      "import { streamText } from 'ai';",
      'export async function POST() {',
      '  return streamText({ model: "gpt-4o", prompt: "hi" });',
      '}',
    ].join('\n');
    expect(scanMaxDuration(code, 'app/api/chat/route.ts').findings[0]).toMatchObject({
      ruleId: 'vercel-maxduration-missing',
      severity: 'warning',
      confidence: 'low',
    });
  });

  it('passes when maxDuration is exported on long-running routes', () => {
    const code = [
      "import { streamText } from 'ai';",
      'export const maxDuration = 60;',
      'export async function POST() {',
      '  return streamText({ model: "gpt-4o", prompt: "hi" });',
      '}',
    ].join('\n');
    expect(scanMaxDuration(code, 'app/api/chat/route.ts').findings).toEqual([]);
  });

  it('correlates RLS across migration files', () => {
    const scan = scanSqlMigrations([
      { file: '1.sql', content: 'create table public.accounts(id uuid);' },
      { file: '2.sql', content: 'alter table accounts enable row level security;' },
    ]);
    expect(scan.findings).toEqual([]);
  });

  it('uses Database table wording when SQL has no Supabase stack signal', () => {
    const scan = scanSqlMigrations([
      { file: 'schema.sql', content: 'create table public.orders(id uuid);' },
    ]);
    expect(scan.findings[0]?.message).toMatch(new RegExp(`^${RLS_GENERIC_TABLE_LABEL} 'orders'`));
    expect(isSupabaseRlsMessage(scan.findings[0]?.message ?? '')).toBe(false);
  });

  it('emits supabase-rls as a medium warning without a Supabase signal', () => {
    const scan = scanSqlMigrations([
      { file: 'prisma/migrations/0.sql', content: 'CREATE TABLE "User" (id uuid PRIMARY KEY);' },
    ]);
    expect(scan.findings[0]?.ruleId).toBe('supabase-rls');
    expect(scan.findings[0]?.severity).toBe('warning');
    expect(scan.findings[0]?.confidence).toBe('medium');
    expect(scan.findings[0]?.message).toMatch(new RegExp(`^${RLS_GENERIC_TABLE_LABEL} 'User'`));
  });

  it('keeps Supabase table wording when migrations mention Supabase', () => {
    const scan = scanSqlMigrations([
      {
        file: 'supabase/migrations/1.sql',
        content: 'create table public.orders(id uuid);',
      },
    ]);
    expect(scan.findings[0]?.message).toMatch(new RegExp(`^${RLS_SUPABASE_TABLE_LABEL} 'orders'`));
    expect(isSupabaseRlsMessage(scan.findings[0]?.message ?? '')).toBe(true);
  });

  it('keeps supabase-rls as a high-confidence error with a Supabase signal', () => {
    const scan = scanSqlMigrations([
      {
        file: 'supabase/migrations/1.sql',
        content: 'create table public.orders(id uuid);\nselect auth.uid();',
      },
    ]);
    const rls = scan.findings.find((finding) => finding.ruleId === 'supabase-rls');
    expect(rls?.severity).toBe('error');
    expect(rls?.confidence).toBe('high');
  });

  it('applies a Supabase signal from one migration to tables in another', () => {
    const scan = scanSqlMigrations([
      { file: 'db/001.sql', content: 'create table public.orders(id uuid);' },
      {
        file: 'supabase/migrations/002.sql',
        content: 'create table public.items(id uuid);',
      },
    ]);
    const rls = scan.findings.filter((finding) => finding.ruleId === 'supabase-rls');
    expect(rls).toHaveLength(2);
    expect(rls.every((finding) => finding.severity === 'error')).toBe(true);
    expect(rls.every((finding) => isSupabaseRlsMessage(finding.message))).toBe(true);
  });

  it('subsumes generic supabase-rls when auth-linked RLS finding exists for the same table', () => {
    const sql = [
      'create table profiles (',
      '  id uuid references auth.users on delete cascade primary key,',
      '  username text unique',
      ');',
      'create table posts (',
      '  id uuid primary key,',
      '  author_id uuid references profiles(id)',
      ');',
      'alter table posts enable row level security;',
    ].join('\n');

    const scan = scanSqlMigrations([{ file: 'schema.sql', content: sql }]);
    const profilesFindings = scan.findings.filter((finding) =>
      /table 'profiles'/i.test(finding.message),
    );

    expect(profilesFindings).toHaveLength(1);
    expect(profilesFindings[0]?.ruleId).toBe('supabase-migration-auth-linked-no-rls');
    expect(scan.findings.some((finding) => finding.ruleId === 'supabase-rls')).toBe(false);
  });

  it('keeps standalone supabase-rls for tables that are not auth-linked', () => {
    const scan = scanSqlMigrations([
      { file: 'schema.sql', content: 'create table public.orders(id uuid);' },
    ]);
    expect(scan.findings).toHaveLength(1);
    expect(scan.findings[0]?.ruleId).toBe('supabase-rls');
  });

  it('does not emit RLS findings for MSSQL SQL', () => {
    const mssql = [
      'CREATE TABLE [dbo].[users] (',
      '  [id] INT IDENTITY(1,1) NOT NULL,',
      '  [email] NVARCHAR(100) NULL,',
      '  [guid] UNIQUEIDENTIFIER NOT NULL',
      ');',
      'GO',
      'CREATE TABLE [dbo].[sessions] (',
      '  [id] INT IDENTITY(1,1) NOT NULL,',
      '  [uid] INT NOT NULL',
      ');',
      'GO',
    ].join('\n');
    const scan = scanSqlMigrations([{ file: 'database_mssql.sql', content: mssql }]);
    expect(scan.findings.filter((finding) => finding.ruleId.includes('rls'))).toEqual([]);
  });

  it('does not emit RLS findings for MySQL SQL', () => {
    const mysql = [
      '-- Adminer 4.2.0 MySQL dump',
      '',
      'CREATE TABLE `attempts` (',
      '  `id` int(11) NOT NULL AUTO_INCREMENT,',
      '  PRIMARY KEY (`id`)',
      ') ENGINE=InnoDB DEFAULT CHARSET=utf8;',
      '',
      'CREATE TABLE `config` (',
      '  `setting` varchar(100) NOT NULL,',
      '  UNIQUE KEY `setting` (`setting`)',
      ') ENGINE=InnoDB DEFAULT CHARSET=utf8;',
      '',
      'CREATE TABLE `requests` (',
      '  `id` int(11) NOT NULL AUTO_INCREMENT,',
      '  PRIMARY KEY (`id`)',
      ') ENGINE=InnoDB DEFAULT CHARSET=utf8;',
      '',
      'CREATE TABLE `sessions` (',
      '  `id` int(11) NOT NULL AUTO_INCREMENT,',
      '  PRIMARY KEY (`id`)',
      ') ENGINE=InnoDB DEFAULT CHARSET=utf8;',
      '',
      'CREATE TABLE `users` (',
      '  `id` int(11) NOT NULL AUTO_INCREMENT,',
      '  PRIMARY KEY (`id`)',
      ') ENGINE=InnoDB DEFAULT CHARSET=utf8;',
    ].join('\n');
    const scan = scanSqlMigrations([{ file: 'database.sql', content: mysql }]);
    expect(scan.findings.filter((finding) => finding.ruleId.includes('rls'))).toEqual([]);
  });

  it('does not emit RLS or migration-safety findings for ClickHouse SQL', () => {
    const clickhouse = [
      'CREATE TABLE IF NOT EXISTS ai_logs (',
      '  id UInt64,',
      '  created_at DateTime64(3),',
      '  payload Nullable(String)',
      ')',
      'ENGINE = MergeTree',
      'PARTITION BY toYYYYMM(created_at)',
      'ORDER BY (created_at, id);',
      'ALTER TABLE ai_logs ADD COLUMN source String NOT NULL;',
    ].join('\n');
    const scan = scanSqlMigrations([
      { file: 'configs/clickhouse/migrations/001_create_ai_logs.sql', content: clickhouse },
    ]);
    expect(scan.findings).toEqual([]);
  });

  it('still flags Postgres tables when a batch also contains ClickHouse SQL', () => {
    const scan = scanSqlMigrations([
      {
        file: 'configs/clickhouse/migrations/001_create_ai_logs.sql',
        content: 'CREATE TABLE ai_logs (id UInt64) ENGINE = MergeTree ORDER BY id;',
      },
      { file: 'db/schema.sql', content: 'create table public.orders(id uuid);' },
    ]);
    expect(scan.findings).toHaveLength(1);
    expect(scan.findings[0]?.ruleId).toBe('supabase-rls');
    expect(scan.findings[0]?.message).toMatch(/'orders'/);
  });

  it('detects service-role access only inside a client boundary', () => {
    expect(
      scanSupabaseClientLeaks(`'use client'; process.env.SUPABASE_SERVICE_ROLE_KEY`).errorCount,
    ).toBe(1);
    expect(scanSupabaseClientLeaks(`process.env.SUPABASE_SERVICE_ROLE_KEY`).errorCount).toBe(0);
  });

  it('marks RSC client-import heuristics as medium confidence', () => {
    const code = `'use client';\nimport { PrismaClient } from '@prisma/client';`;
    const finding = scanRscDataLeaks(code).findings[0];
    expect(finding?.confidence).toBe('medium');
  });

  it('does not flag type-only imports from server modules', () => {
    const code = `'use client';\nimport type { User } from '../../utils/dbAdapter';`;
    expect(scanRscDataLeaks(code).findings).toEqual([]);
  });
});

describe('scanEnvVariables monorepo matching', () => {
  const allExamples = [
    { file: '.env.example', content: 'ROOT_KEY=\n' },
    { file: 'apps/web/.env.example', content: 'WEB_KEY=\n' },
  ];

  it('matches the nearest app-root .env.example for code paths', () => {
    const result = scanEnvVariables(
      '',
      'const x = process.env.WEB_KEY;',
      '.env.example',
      'apps/web/src/app/page.tsx',
      {
        allExamples,
      },
    );
    expect(result.errorCount).toBe(0);

    const missing = scanEnvVariables(
      '',
      'const x = process.env.MISSING_KEY;',
      '.env.example',
      'apps/web/src/app/page.tsx',
      {
        allExamples,
      },
    );
    expect(missing.errorCount).toBe(0);
    const undocumented = missing.findings.filter((f) => f.ruleId === 'undocumented-env');
    expect(undocumented).toHaveLength(1);
    expect(undocumented[0]?.severity).toBe('warning');
    expect(undocumented[0]?.message).toContain('apps/web/.env.example');
  });

  it('resolves nearest example path helper', () => {
    expect(resolveEnvExampleForPath('apps/web/src/page.tsx', allExamples)?.file).toBe(
      'apps/web/.env.example',
    );
    expect(resolveEnvExampleForPath('packages/cli/src/index.ts', allExamples)?.file).toBe(
      '.env.example',
    );
  });

  it('proposes package-local .env.example paths without stealing sibling apps', () => {
    expect(proposeEnvExamplePath('shipready/packages/cli/src/index.ts')).toBe(
      'shipready/packages/cli/.env.example',
    );
    expect(proposeEnvExamplePath('packages/cli/src/index.ts')).toBe('packages/cli/.env.example');
    expect(proposeEnvExamplePath('apps/web/src/lib/env.ts')).toBe('apps/web/.env.example');
    expect(proposeEnvExamplePath('src/app.ts')).toBe('.env.example');
  });

  it('does not attribute package code to a non-ancestor apps/web .env.example', () => {
    const webOnlyExamples = [{ file: 'apps/web/.env.example', content: 'WEB_KEY=\n' }];
    const result = scanEnvVariables(
      '',
      'const key = process.env.ASSURLY_API_KEY;',
      'apps/web/.env.example',
      'packages/cli/src/index.ts',
      { allExamples: webOnlyExamples },
    );

    const undocumented = result.findings.filter((finding) => finding.ruleId === 'undocumented-env');
    expect(undocumented).toHaveLength(1);
    expect(undocumented[0]?.message).toContain('packages/cli/.env.example');
    expect(undocumented[0]?.message).not.toContain('apps/web/.env.example');
    expect(undocumented[0]?.suggestion).toContain('packages/cli/.env.example');
  });

  it('does not treat process.env.KEY inside a string literal as usage', () => {
    const result = scanEnvVariables(
      'PORT=3000\n',
      "const hint = 'Rotate the key and replace it with process.env.STRIPE_SECRET_KEY.';",
      '.env.example',
      'src/rules/stripeRules.ts',
    );
    expect(result.findings.filter((finding) => finding.ruleId === 'undocumented-env')).toEqual([]);
  });

  it('still flags a real process.env.KEY identifier', () => {
    const result = scanEnvVariables(
      'PORT=3000\n',
      'const key = process.env.STRIPE_SECRET_KEY;',
      '.env.example',
      'src/route.ts',
    );
    const undocumented = result.findings.filter((finding) => finding.ruleId === 'undocumented-env');
    expect(undocumented).toHaveLength(1);
    expect(undocumented[0]?.message).toContain('STRIPE_SECRET_KEY');
  });

  it('treats only application source as the CLI env-docs surface', () => {
    expect(isAppEnvSourceFile('apps/web/src/lib/env.ts')).toBe(true);
    expect(isAppEnvSourceFile('src/route.ts')).toBe(true);
    expect(isAppEnvSourceFile('packages/cli/src/rules/stripeRules.ts')).toBe(false);
    expect(isAppEnvSourceFile('README.md')).toBe(false);
  });

  it('ignores framework, CI, Actions runtime, and test-only env keys', () => {
    const testSources = [
      { file: 'src/testing/e2e.ts', content: 'process.env.E2E_ONLY;' },
      { file: 'src/app.ts', content: 'process.env.NODE_ENV;' },
    ];
    const testOnlyKeys = collectTestOnlyEnvKeys(testSources);

    const result = scanEnvVariables(
      '',
      [
        ...testSources.map((s) => s.content),
        'process.env.GITHUB_OUTPUT;',
        'process.env.GITHUB_STEP_SUMMARY;',
      ].join('\n'),
      '.env.example',
      'src/app.ts',
      {
        testOnlyKeys,
      },
    );
    expect(result.findings.some((finding) => finding.message.includes('E2E_ONLY'))).toBe(false);
    expect(result.findings.some((finding) => finding.message.includes('NODE_ENV'))).toBe(false);
    expect(result.findings.some((finding) => finding.message.includes('GITHUB_OUTPUT'))).toBe(
      false,
    );
    expect(result.findings.some((finding) => finding.message.includes('GITHUB_STEP_SUMMARY'))).toBe(
      false,
    );
  });

  it('treats NEXT_PUBLIC_* keys as documenting server-side fallback names', () => {
    const result = scanEnvVariables(
      'NEXT_PUBLIC_SUPABASE_URL=\nNEXT_PUBLIC_SUPABASE_ANON_KEY=',
      'const url = process.env.SUPABASE_URL;\nconst key = process.env.SUPABASE_ANON_KEY;',
      'apps/web/.env.example',
      'apps/web/src/utils/env.ts',
    );
    expect(result.errorCount).toBe(0);
  });

  it('emits undocumented-env as a high-confidence warning, never an error', () => {
    const result = scanEnvVariables(
      '',
      'const path = process.env.NEXT_PUBLIC_BASE_PATH;',
      '.env.example',
      'apps/web/src/lib/config.ts',
    );

    expect(result.errorCount).toBe(0);
    expect(result.warningCount).toBe(1);
    expect(result.findings[0]).toMatchObject({
      ruleId: 'undocumented-env',
      severity: 'warning',
      confidence: 'high',
    });
  });
});
