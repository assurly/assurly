import { describe, expect, it } from 'vitest';
import {
  incompleteScanFinding,
  scanEdgeRuntime,
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
    expect(scanEdgeRuntime(code, 'app/api/route.ts').errorCount).toBe(1);
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
});
