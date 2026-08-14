import { describe, expect, it } from 'vitest';
import {
  applyAllFixableFindingsToProject,
  applyEnvVarsToExampleFiles,
  appendRlsFix,
  countFixableFindings,
  fixStripeWebhook,
  isManualFindingFixable,
} from './projectAutoFix';
import type { ProjectFile } from './useManualScan';
import type { WebFinding } from '../../../../utils/browserScanner';
import { scanProject } from './projectWorkspace';

const ENV_EXAMPLE: ProjectFile = {
  path: 'Attesta/.env.example',
  content: 'PORT=3000\n',
};

const SQL_SCHEMA: ProjectFile = {
  path: 'Attesta/db/schema.sql',
  content:
    'create table organizations (id uuid primary key);\ncreate table users (id uuid primary key);',
};

const PLAYWRIGHT_CONFIG: ProjectFile = {
  path: 'Attesta/web/playwright.config.ts',
  content: [
    'export default defineConfig({',
    '  forbidOnly: !!process.env.CI,',
    '  retries: process.env.CI ? 2 : 0,',
    '});',
  ].join('\n'),
};

function envFinding(
  varName: string,
  file: string,
  line: number,
  examplePath = 'Attesta/.env.example',
): WebFinding {
  return {
    ruleId: 'undocumented-env',
    severity: 'warning',
    file,
    line,
    message: `Environment variable 'process.env.${varName}' is used but not documented in '${examplePath}'.`,
    suggestion: `Add ${varName}= to ${examplePath}.`,
  };
}

function rlsFinding(table: string, file: string): WebFinding {
  return {
    ruleId: 'supabase-rls',
    severity: 'error',
    file,
    line: 1,
    message: `Supabase table '${table}' is created but Row-Level Security (RLS) is not enabled.`,
  };
}

describe('projectAutoFix', () => {
  it('detects fixable finding types', () => {
    expect(isManualFindingFixable(envFinding('CI', PLAYWRIGHT_CONFIG.path, 2))).toBe(true);
    expect(isManualFindingFixable(rlsFinding('users', SQL_SCHEMA.path))).toBe(true);
    expect(
      isManualFindingFixable({
        ruleId: 'stripe-secret-leak',
        severity: 'error',
        message: 'CRITICAL KEY LEAK: Hardcoded Stripe secret key found (sk_test...).',
        file: 'Attesta/.env',
      }),
    ).toBe(false);
  });

  it('deduplicates env vars when fixing all findings at once', () => {
    const findings: WebFinding[] = [
      envFinding('CI', PLAYWRIGHT_CONFIG.path, 2),
      envFinding('CI', PLAYWRIGHT_CONFIG.path, 3),
      envFinding('CI', PLAYWRIGHT_CONFIG.path, 4),
    ];

    expect(countFixableFindings(findings)).toBe(3);

    const result = applyAllFixableFindingsToProject([ENV_EXAMPLE, PLAYWRIGHT_CONFIG], findings);

    const envExample = result.files.find((file) => file.path === ENV_EXAMPLE.path);
    expect(envExample?.content).toContain('CI=');
    expect(envExample?.content.match(/^CI=/gm)).toHaveLength(1);
    expect(result.envVarsAdded).toBe(1);
    expect(result.appliedFindingCount).toBe(3);
  });

  it('appends multiple RLS fixes in one migration file', () => {
    const findings = [
      rlsFinding('organizations', SQL_SCHEMA.path),
      rlsFinding('users', SQL_SCHEMA.path),
    ];

    const result = applyAllFixableFindingsToProject([SQL_SCHEMA], findings);
    const sql = result.files.find((file) => file.path === SQL_SCHEMA.path)?.content ?? '';

    expect(sql).toContain('ALTER TABLE organizations ENABLE ROW LEVEL SECURITY');
    expect(sql).toContain('ALTER TABLE users ENABLE ROW LEVEL SECURITY');
    expect(result.rlsTablesFixed).toBe(2);
  });

  it('creates .env.example when missing', () => {
    const updated = applyEnvVarsToExampleFiles([PLAYWRIGHT_CONFIG], ['CI', 'NODE_ENV']);
    const envExample = updated.find((file) => file.path.endsWith('.env.example'));

    expect(envExample).toBeTruthy();
    expect(envExample?.content).toContain('CI=');
    expect(envExample?.content).toContain('NODE_ENV=');
  });

  it('does not duplicate an existing env example entry', () => {
    const updated = applyEnvVarsToExampleFiles([ENV_EXAMPLE], ['PORT', 'CI']);
    expect(updated.find((file) => file.path === ENV_EXAMPLE.path)?.content).toBe('PORT=3000\nCI=');
  });

  it('skips duplicate RLS statements on repeated apply', () => {
    const once = appendRlsFix(SQL_SCHEMA.content, 'organizations');
    const twice = appendRlsFix(once, 'organizations');
    expect(twice.match(/ALTER TABLE organizations ENABLE ROW LEVEL SECURITY/g)).toHaveLength(1);
  });

  it('rewrites Stripe webhook body read without double semicolon or vuln comment', () => {
    const vulnerable = [
      "import { NextResponse } from 'next/server';",
      "import Stripe from 'stripe';",
      '',
      'const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);',
      '',
      'export async function POST(req: Request) {',
      '  // Vulnerability: Missing Stripe signature verification!',
      '  const body = await req.json();',
      '  const eventType = body.type;',
      '  return NextResponse.json({ received: true });',
      '}',
    ].join('\n');

    const fixed = fixStripeWebhook(vulnerable);

    expect(fixed).not.toContain('Vulnerability: Missing Stripe signature verification!');
    expect(fixed).not.toContain('event;;');
    expect(fixed).toContain('const body = event;');
    expect(fixed).toContain('const rawBody = await req.text();');
    expect(fixed).toContain('stripe.webhooks.constructEvent');
    // Nested block uses the same 2-space base indent as the original statement.
    expect(fixed).toContain(
      '  event = stripe.webhooks.constructEvent(rawBody, signature, process.env.STRIPE_WEBHOOK_SECRET!);',
    );
    expect(fixed).not.toMatch(/^\s{4}const signature/m);
  });

  it('writes CLI env docs to packages/cli/.env.example, not apps/web', () => {
    const webExample: ProjectFile = {
      path: 'apps/web/.env.example',
      content: 'NEXT_PUBLIC_SUPABASE_URL=\n',
    };
    const cliSource: ProjectFile = {
      path: 'packages/cli/src/index.ts',
      content: 'export const key = process.env.ASSURLY_API_KEY;',
    };
    const findings: WebFinding[] = [
      envFinding('ASSURLY_API_KEY', cliSource.path, 1, 'packages/cli/.env.example'),
    ];

    const result = applyAllFixableFindingsToProject([webExample, cliSource], findings);
    const web = result.files.find((file) => file.path === webExample.path)?.content ?? '';
    const cliExample = result.files.find((file) => file.path === 'packages/cli/.env.example');

    expect(web).toBe(webExample.content);
    expect(cliExample?.content).toContain('ASSURLY_API_KEY=');
    expect(result.envVarsAdded).toBe(1);
  });

  it('documents STRIPE_WEBHOOK_SECRET in the same Fix-all pass as the webhook rewrite', () => {
    const webhook: ProjectFile = {
      path: 'demo/app/api/webhook/route.ts',
      content: [
        "import Stripe from 'stripe';",
        'const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);',
        'export async function POST(req: Request) {',
        '  const body = await req.json();',
        '  return Response.json({ type: body.type });',
        '}',
      ].join('\n'),
    };
    const envExample: ProjectFile = {
      path: 'demo/.env.example',
      // STRIPE_SECRET_KEY already documented; only WEBHOOK_SECRET is introduced by the fix.
      content: 'PORT=3000\nSTRIPE_SECRET_KEY=\n',
    };
    const findings: WebFinding[] = [
      {
        ruleId: 'stripe-webhook-no-signature',
        severity: 'error',
        file: webhook.path,
        line: 1,
        message: 'Stripe webhook endpoint appears to lack signature verification.',
        suggestion:
          'Verify the raw request body with stripe.webhooks.constructEvent before processing the event.',
      },
    ];

    const result = applyAllFixableFindingsToProject([webhook, envExample], findings);
    const env = result.files.find((file) => file.path === envExample.path)?.content ?? '';
    const route = result.files.find((file) => file.path === webhook.path)?.content ?? '';

    expect(route).toContain('constructEvent');
    expect(env).toContain('STRIPE_WEBHOOK_SECRET=');
    expect(result.stripeFilesFixed).toBe(1);

    const rescan = scanProject(result.files);
    expect(countFixableFindings(rescan.findings)).toBe(0);
  });
});
