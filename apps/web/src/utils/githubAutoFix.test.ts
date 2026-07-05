import { describe, expect, it } from 'vitest';
import {
  applyAutoFixToFileContent,
  buildGitHubAutoFix,
  buildGitHubAutoFixBatch,
  isAutoFixableFinding,
  resolveEnvExamplePath,
} from './githubAutoFix';

describe('isAutoFixableFinding', () => {
  it('allows undocumented-env findings from source files', () => {
    expect(
      isAutoFixableFinding({
        severity: 'error',
        file_path: 'apps/web/src/lib/stripe.ts',
        message:
          "Environment variable 'process.env.STRIPE_SECRET_KEY' is used but not documented in '.env.example'.",
        rule_id: 'undocumented-env',
      }),
    ).toBe(true);
  });

  it('allows github-actions-integration warnings', () => {
    expect(
      isAutoFixableFinding({
        severity: 'warning',
        file_path: 'Global Configs',
        message: 'GitHub Actions workflow for ShipReady is missing.',
        rule_id: 'github-actions-integration',
      }),
    ).toBe(true);
  });
});

describe('buildGitHubAutoFix', () => {
  it('generates an env example append fix for undocumented-env', () => {
    const fix = buildGitHubAutoFix(
      'apps/web/src/lib/stripe.ts',
      "Environment variable 'process.env.STRIPE_SECRET_KEY' is used but not documented in '.env.example'.",
      'undocumented-env',
    );

    expect(fix).toMatchObject({
      statement: 'STRIPE_SECRET_KEY=',
      targetFilePath: 'apps/web/.env.example',
      applyMode: 'append',
    });
  });

  it('generates the ShipReady workflow snippet for github-actions-integration', () => {
    const fix = buildGitHubAutoFix(
      'Global Configs',
      'GitHub Actions workflow for ShipReady is missing.',
      'github-actions-integration',
    );

    expect(fix?.targetFilePath).toBe('.github/workflows/shipready.yml');
    expect(fix?.statement).toContain('name: ShipReady Security & Config Scan');
    expect(fix?.applyMode).toBe('create');
  });
});

describe('applyAutoFixToFileContent idempotency', () => {
  it('does not duplicate env example entries', () => {
    const fix = buildGitHubAutoFix(
      'apps/web/src/lib/stripe.ts',
      "Environment variable 'process.env.STRIPE_SECRET_KEY' is used but not documented in '.env.example'.",
      'undocumented-env',
    );
    expect(fix).toBeTruthy();
    if (!fix) return;

    const once = applyAutoFixToFileContent('PORT=3000\n', fix);
    const twice = applyAutoFixToFileContent(once, fix);

    expect(once).toContain('STRIPE_SECRET_KEY=');
    expect(twice).toBe(once);
  });

  it('does not rewrite an existing workflow file twice', () => {
    const fix = buildGitHubAutoFix(
      'Global Configs',
      'GitHub Actions workflow for ShipReady is missing.',
      'github-actions-integration',
    );
    expect(fix).toBeTruthy();
    if (!fix) return;

    const once = applyAutoFixToFileContent('', fix);
    const twice = applyAutoFixToFileContent(once, fix);

    expect(once).toContain('Run ShipReady Scan');
    expect(twice).toBe(once);
  });
});

describe('resolveEnvExamplePath', () => {
  it('resolves monorepo app env example paths', () => {
    expect(resolveEnvExamplePath('apps/web/src/lib/stripe.ts')).toBe('apps/web/.env.example');
    expect(resolveEnvExamplePath('packages/scanner-core/src/index.ts')).toBe(
      'packages/scanner-core/.env.example',
    );
  });
});

describe('buildGitHubAutoFixBatch', () => {
  it('combines multiple RLS fixes in the same SQL file', () => {
    const fix = buildGitHubAutoFixBatch([
      {
        file_path: 'database.sql',
        message:
          "Supabase table 'attempts' is created but Row-Level Security (RLS) is not enabled.",
      },
      {
        file_path: 'database.sql',
        message: "Supabase table 'config' is created but Row-Level Security (RLS) is not enabled.",
      },
    ]);

    expect(fix?.title).toBe('security(rls): enable row level security on 2 tables');
    expect(fix?.statement).toContain('ALTER TABLE "attempts" ENABLE ROW LEVEL SECURITY;');
    expect(fix?.statement).toContain('ALTER TABLE "config" ENABLE ROW LEVEL SECURITY;');
  });
});
