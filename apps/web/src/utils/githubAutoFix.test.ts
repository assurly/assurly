import { describe, expect, it } from 'vitest';
import {
  applyAutoFixToFileContent,
  buildGitHubAutoFix,
  buildGitHubAutoFixBatch,
  buildGitHubAutoFixPlan,
  isAutoFixableFinding,
  resolveEnvExamplePath,
  resolveFindingAutoFixTargetPath,
  summarizeAutoFixPlan,
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
        message: 'GitHub Actions workflow for Assurly is missing.',
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

  it('generates the Assurly workflow snippet for github-actions-integration', () => {
    const fix = buildGitHubAutoFix(
      'Global Configs',
      'GitHub Actions workflow for Assurly is missing.',
      'github-actions-integration',
    );

    expect(fix?.targetFilePath).toBe('.github/workflows/assurly.yml');
    expect(fix?.statement).toContain('name: Assurly Security & Config Scan');
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
      'GitHub Actions workflow for Assurly is missing.',
      'github-actions-integration',
    );
    expect(fix).toBeTruthy();
    if (!fix) return;

    const once = applyAutoFixToFileContent('', fix);
    const twice = applyAutoFixToFileContent(once, fix);

    expect(once).toContain('Run Assurly Scan');
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

describe('buildGitHubAutoFixPlan', () => {
  it('groups fixes across multiple target files into one plan', () => {
    const plan = buildGitHubAutoFixPlan([
      {
        file_path: 'supabase/schema.sql',
        message:
          "Supabase table 'attempts' is created but Row-Level Security (RLS) is not enabled.",
      },
      {
        file_path: 'apps/web/src/lib/stripe.ts',
        message:
          "Environment variable 'process.env.STRIPE_SECRET_KEY' is used but not documented in '.env.example'.",
        rule_id: 'undocumented-env',
      },
      {
        file_path: 'apps/web/src/lib/db.ts',
        message:
          "Environment variable 'process.env.DATABASE_URL' is used but not documented in '.env.example'.",
        rule_id: 'undocumented-env',
      },
      {
        file_path: 'Global Configs',
        message: 'GitHub Actions workflow for Assurly is missing.',
        rule_id: 'github-actions-integration',
      },
    ]);

    expect(plan).not.toBeNull();
    const paths = plan?.map((group) => group.filePath) ?? [];
    expect(paths).toEqual([
      'supabase/schema.sql',
      'apps/web/.env.example',
      '.github/workflows/assurly.yml',
    ]);

    const envGroup = plan?.find((group) => group.filePath === 'apps/web/.env.example');
    expect(envGroup?.fixes.map((fix) => fix.statement)).toEqual([
      'STRIPE_SECRET_KEY=',
      'DATABASE_URL=',
    ]);
  });

  it('deduplicates identical statements targeting the same file', () => {
    const plan = buildGitHubAutoFixPlan([
      {
        file_path: 'apps/web/src/lib/a.ts',
        message:
          "Environment variable 'process.env.SHARED_KEY' is used but not documented in '.env.example'.",
        rule_id: 'undocumented-env',
      },
      {
        file_path: 'apps/web/src/lib/b.ts',
        message:
          "Environment variable 'process.env.SHARED_KEY' is used but not documented in '.env.example'.",
        rule_id: 'undocumented-env',
      },
    ]);

    expect(plan?.[0]?.fixes).toHaveLength(1);
  });

  it('returns null when a finding cannot be turned into a fix', () => {
    expect(
      buildGitHubAutoFixPlan([{ file_path: 'src/index.ts', message: 'Some non-fixable finding.' }]),
    ).toBeNull();
  });
});

describe('resolveFindingAutoFixTargetPath', () => {
  it('redirects env findings to the resolved .env.example file', () => {
    expect(
      resolveFindingAutoFixTargetPath({
        file_path: 'apps/web/src/lib/stripe.ts',
        message:
          "Environment variable 'process.env.STRIPE_SECRET_KEY' is used but not documented in '.env.example'.",
        rule_id: 'undocumented-env',
      }),
    ).toBe('apps/web/.env.example');
  });

  it('redirects github-actions findings to the workflow file', () => {
    expect(
      resolveFindingAutoFixTargetPath({
        file_path: 'Global Configs',
        message: 'GitHub Actions workflow for Assurly is missing.',
        rule_id: 'github-actions-integration',
      }),
    ).toBe('.github/workflows/assurly.yml');
  });

  it('keeps the finding path for RLS findings', () => {
    expect(
      resolveFindingAutoFixTargetPath({
        file_path: 'db/schema.sql',
        message: "Supabase table 'users' is created but Row-Level Security (RLS) is not enabled.",
      }),
    ).toBe('db/schema.sql');
  });
});

describe('summarizeAutoFixPlan', () => {
  it('summarizes fix and file counts for the combined PR', () => {
    const plan = buildGitHubAutoFixPlan([
      {
        file_path: 'supabase/schema.sql',
        message:
          "Supabase table 'attempts' is created but Row-Level Security (RLS) is not enabled.",
      },
      {
        file_path: 'apps/web/src/lib/stripe.ts',
        message:
          "Environment variable 'process.env.STRIPE_SECRET_KEY' is used but not documented in '.env.example'.",
        rule_id: 'undocumented-env',
      },
    ]);
    expect(plan).not.toBeNull();
    if (!plan) return;

    const summary = summarizeAutoFixPlan(plan);
    expect(summary.prTitle).toBe('fix(assurly): apply 2 automated fixes');
    expect(summary.prDescription).toContain('across 2 files');
    expect(summary.prDescription).toContain('`supabase/schema.sql`');
    expect(summary.prDescription).toContain('`apps/web/.env.example`');
  });
});
