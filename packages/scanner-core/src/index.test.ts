import { describe, expect, it } from 'vitest';
import {
  collectTestOnlyEnvKeys,
  incompleteScanFinding,
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
    expect(missing.errorCount).toBe(1);
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

  it('ignores framework, CI, and test-only env keys', () => {
    const testSources = [
      { file: 'src/testing/e2e.ts', content: 'process.env.E2E_ONLY;' },
      { file: 'src/app.ts', content: 'process.env.NODE_ENV;' },
    ];
    const testOnlyKeys = collectTestOnlyEnvKeys(testSources);

    const result = scanEnvVariables(
      '',
      testSources.map((s) => s.content).join('\n'),
      '.env.example',
      'src/app.ts',
      {
        testOnlyKeys,
      },
    );
    expect(result.findings.some((finding) => finding.message.includes('E2E_ONLY'))).toBe(false);
    expect(result.findings.some((finding) => finding.message.includes('NODE_ENV'))).toBe(false);
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
});
