import { describe, expect, it } from 'vitest';
import {
  collectTestOnlyEnvKeys,
  incompleteScanFinding,
  proposeEnvExamplePath,
  resolveEnvExampleForPath,
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
    expect(scan.findings[0]?.message).toMatch(/^Database table 'orders'/);
  });

  it('keeps Supabase table wording when migrations mention Supabase', () => {
    const scan = scanSqlMigrations([
      {
        file: 'supabase/migrations/1.sql',
        content: 'create table public.orders(id uuid);',
      },
    ]);
    expect(scan.findings[0]?.message).toMatch(/^Supabase table 'orders'/);
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
    expect(missing.warningCount).toBe(1);
    expect(missing.findings[0]?.severity).toBe('warning');
    expect(missing.findings[0]?.message).toContain('apps/web/.env.example');
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

    expect(result.warningCount).toBe(1);
    expect(result.findings[0]?.message).toContain('packages/cli/.env.example');
    expect(result.findings[0]?.message).not.toContain('apps/web/.env.example');
    expect(result.findings[0]?.suggestion).toContain('packages/cli/.env.example');
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
