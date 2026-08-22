import { describe, expect, it } from 'vitest';
import { SUPPLY_INSTALL_SCRIPTS_UNREVIEWED } from './supplyChain';
import { buildShipGateReport } from './shipGate';
import {
  GITHUB_ACTIONS_EXISTING_CI_MESSAGE,
  GITHUB_ACTIONS_MISSING_ASSURLY_MESSAGE,
  scanGithubActionsIntegration,
  scanTsconfigStrict,
  scanWorkspaceFiles,
} from './workspaceScan';

/** Built at runtime so GitHub secret scanning does not reject the upload. */
const FAKE_STRIPE_TEST_KEY = `sk_${'test'}_${'abcdefghijklmnopqrstuvwx'}`;

function lockfileV3(packages: Record<string, Record<string, unknown>>): string {
  return JSON.stringify({
    name: 'fixture',
    lockfileVersion: 3,
    requires: true,
    packages: {
      '': { name: 'fixture', version: '1.0.0' },
      ...packages,
    },
  });
}

describe('scanWorkspaceFiles', () => {
  it('does not emit supabase-rls when a later migration enables RLS', () => {
    const result = scanWorkspaceFiles([
      {
        file: 'supabase/migrations/1.sql',
        content: 'create table if not exists private.tokens (id text primary key);',
      },
      {
        file: 'supabase/migrations/2.sql',
        content: 'alter table private.tokens enable row level security;',
      },
    ]);
    expect(result.findings.some((finding) => finding.ruleId === 'supabase-rls')).toBe(false);
  });

  it('still flags a public Supabase table created without RLS', () => {
    const result = scanWorkspaceFiles([
      {
        file: 'supabase/migrations/1.sql',
        content: 'create table public.orders (id uuid primary key);',
      },
    ]);
    const rls = result.findings.find((finding) => finding.ruleId === 'supabase-rls');
    expect(rls?.severity).toBe('error');
    expect(rls?.confidence).toBe('high');
  });

  it('ignores process.env inside suggestion strings and tooling packages', () => {
    const result = scanWorkspaceFiles([
      { file: '.env.example', content: 'PORT=3000\n' },
      {
        file: 'packages/cli/src/rules/stripeRules.ts',
        content:
          "export const hint = 'Rotate the key and replace it with process.env.STRIPE_SECRET_KEY.';",
      },
      {
        file: 'packages/cli/src/index.ts',
        content: 'export const url = process.env.ASSURLY_API_URL;',
      },
    ]);
    expect(
      result.findings.some(
        (finding) =>
          finding.ruleId === 'undocumented-env' && finding.message.includes('STRIPE_SECRET_KEY'),
      ),
    ).toBe(false);
    expect(
      result.findings.some(
        (finding) =>
          finding.ruleId === 'undocumented-env' && finding.message.includes('ASSURLY_API_URL'),
      ),
    ).toBe(false);
  });

  it('matches CLI warnings for missing root tsconfig and unreviewed install scripts', () => {
    const result = scanWorkspaceFiles([
      { file: 'package.json', content: JSON.stringify({ name: 'app', private: true }) },
      {
        file: 'package-lock.json',
        content: lockfileV3({
          'node_modules/esbuild': { version: '0.28.1', hasInstallScript: true },
        }),
      },
      { file: 'src/app.ts', content: 'export const ok = true;\n' },
    ]);
    const ids = result.findings.map((finding) => finding.ruleId);
    expect(ids).toContain('typescript-strict-mode');
    expect(ids).toContain(SUPPLY_INSTALL_SCRIPTS_UNREVIEWED);
    const report = buildShipGateReport(result.findings, {
      scannedFileCount: 3,
      cleanFileCount: 2,
    });
    expect(report.blockers).toHaveLength(0);
    expect(report.status).not.toBe('blocked');
  });

  it('flags a Prisma client constructed inside an API route', () => {
    const result = scanWorkspaceFiles([
      {
        file: 'app/api/users/route.ts',
        content: [
          "import { PrismaClient } from '@prisma/client';",
          'export async function GET() {',
          '  const prisma = new PrismaClient();',
          '  return prisma.user.findMany();',
          '}',
        ].join('\n'),
      },
    ]);
    expect(
      result.findings.some((finding) => finding.ruleId === 'database-connection-pooling'),
    ).toBe(true);
  });

  it('does not treat a gitignored .env.local Stripe key as a blocker', () => {
    const result = scanWorkspaceFiles([
      {
        file: '.gitignore',
        content: '.env\n.env.local\n.env.*.local\n',
      },
      {
        file: 'apps/web/.env.local',
        content: `STRIPE_SECRET_KEY=${FAKE_STRIPE_TEST_KEY}\n`,
      },
      { file: 'apps/web/.env.example', content: 'STRIPE_SECRET_KEY=\nPORT=3000\n' },
      { file: 'package.json', content: JSON.stringify({ name: 'app', private: true }) },
      {
        file: 'package-lock.json',
        content: lockfileV3({
          'node_modules/esbuild': { version: '0.28.1', hasInstallScript: true },
        }),
      },
      { file: 'src/app.ts', content: 'export const ok = true;\n' },
    ]);
    expect(result.findings.some((finding) => finding.ruleId === 'stripe-secret-leak')).toBe(false);
    const ids = result.findings.map((finding) => finding.ruleId);
    expect(ids).toContain('typescript-strict-mode');
    expect(ids).toContain(SUPPLY_INSTALL_SCRIPTS_UNREVIEWED);
    const report = buildShipGateReport(result.findings, {
      scannedFileCount: 5,
      cleanFileCount: 4,
    });
    expect(report.blockers).toHaveLength(0);
  });

  it('still blocks a Stripe secret committed in .env.example', () => {
    const result = scanWorkspaceFiles([
      {
        file: 'apps/web/.env.example',
        content: `STRIPE_SECRET_KEY=${FAKE_STRIPE_TEST_KEY}\n`,
      },
    ]);
    const leak = result.findings.find((finding) => finding.ruleId === 'stripe-secret-leak');
    expect(leak?.severity).toBe('error');
    expect(leak?.file).toBe('apps/web/.env.example');
  });

  it('still sees apps/web/.env.example when nested gitignore uses .env*', () => {
    const result = scanWorkspaceFiles([
      { file: '.gitignore', content: '.env\n.env.local\n' },
      { file: 'apps/web/.gitignore', content: '.env*\n' },
      {
        file: 'apps/web/.env.local',
        content: `STRIPE_SECRET_KEY=${FAKE_STRIPE_TEST_KEY}\n`,
      },
      { file: 'apps/web/.env.example', content: 'PORT=3000\n' },
      { file: 'src/app.ts', content: 'export const ok = true;\n' },
    ]);
    expect(result.findings.some((finding) => finding.ruleId === 'stripe-secret-leak')).toBe(false);
    expect(result.findings.some((finding) => finding.ruleId === 'env-vars-validator')).toBe(false);
    expect(result.findings.some((finding) => finding.ruleId === 'assurly-canary-missing')).toBe(
      true,
    );
  });
});

describe('scanTsconfigStrict', () => {
  it('warns when no tsconfig exists', () => {
    const result = scanTsconfigStrict([
      { file: 'src/app.ts', content: 'export const ok = true;\n' },
    ]);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]?.ruleId).toBe('typescript-strict-mode');
    expect(result.findings[0]?.message).toContain('No tsconfig.json file found');
  });

  it('accepts apps/web/tsconfig.json with strict true when root is missing', () => {
    const result = scanTsconfigStrict([
      {
        file: 'apps/web/tsconfig.json',
        content: JSON.stringify({ compilerOptions: { strict: true } }),
      },
    ]);
    expect(result.findings).toEqual([]);
  });

  it('warns on a root tsconfig that is not strict even if a workspace config is', () => {
    const result = scanTsconfigStrict([
      { file: 'tsconfig.json', content: JSON.stringify({ compilerOptions: { target: 'ES2017' } }) },
      {
        file: 'apps/web/tsconfig.json',
        content: JSON.stringify({ compilerOptions: { strict: true } }),
      },
    ]);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]?.file).toBe('tsconfig.json');
    expect(result.findings[0]?.message).toContain('strict mode is disabled or not set');
  });

  it('warns when a workspace tsconfig is not strict', () => {
    const result = scanTsconfigStrict([
      {
        file: 'apps/web/tsconfig.json',
        content: JSON.stringify({ compilerOptions: { target: 'ES2017' } }),
      },
    ]);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]?.file).toBe('apps/web/tsconfig.json');
  });
});

describe('scanGithubActionsIntegration', () => {
  it('says CI is missing when the repo has no workflows', () => {
    const result = scanGithubActionsIntegration([{ file: 'README.md', content: '# app' }]);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]?.message).toBe(GITHUB_ACTIONS_MISSING_ASSURLY_MESSAGE);
  });

  it('says existing CI is unwired when workflows exist without an Assurly step', () => {
    const result = scanGithubActionsIntegration([
      {
        file: '.github/workflows/ci.yml',
        content: 'name: CI\njobs:\n  test:\n    steps:\n      - run: npm test\n',
      },
      {
        file: '.github/workflows/deploy.yml',
        content: 'name: Deploy\njobs:\n  deploy:\n    steps:\n      - run: echo ship\n',
      },
    ]);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]?.message).toBe(GITHUB_ACTIONS_EXISTING_CI_MESSAGE);
  });

  it('stays silent when a workflow already runs Assurly', () => {
    const result = scanGithubActionsIntegration([
      {
        file: '.github/workflows/ci.yml',
        content: 'name: CI\njobs:\n  scan:\n    steps:\n      - run: npx assurly scan\n',
      },
    ]);
    expect(result.findings).toEqual([]);
  });
});
