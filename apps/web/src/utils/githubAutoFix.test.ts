import { describe, expect, it } from 'vitest';
import {
  applyAutoFixToFileContent,
  buildGitHubAutoFix,
  buildGitHubAutoFixPlan,
  isAutoFixableFinding,
  resolveEnvExamplePath,
  resolveFindingAutoFixTargetPath,
  resolveRlsMigrationTarget,
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
    expect(fix?.statement).toContain('npx --yes assurly@1 scan');
    // The scan is static analysis: no dependency install and no lockfile-bound
    // npm cache, so the workflow works on repos with package.json in a subdir.
    expect(fix?.statement).not.toContain('npm ci');
    expect(fix?.statement).not.toContain("cache: 'npm'");
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

describe('RLS auto-fix', () => {
  it('enables RLS in a new migration with a policy scaffold, not the applied file', () => {
    const fix = buildGitHubAutoFix(
      'db/migrations/003_create_auth_schema.up.sql',
      "Supabase table 'organizations' is created but Row-Level Security (RLS) is not enabled.",
    );

    // Written to a NEW migration (99999999999999 sorts last), not appended to
    // the already-applied 003 file, so it reaches a live database.
    expect(fix?.targetFilePath).toBe('db/migrations/99999999999999_assurly_enable_rls.up.sql');
    expect(fix?.applyMode).toBe('append');
    expect(fix?.statement).toContain('ALTER TABLE "organizations" ENABLE ROW LEVEL SECURITY;');
    // Loud about deny-all + a commented, deliberately-incomplete policy scaffold.
    expect(fix?.statement).toContain('returns zero rows');
    expect(fix?.statement).toContain('-- CREATE POLICY "assurly_organizations"');
    expect(fix?.statement).toContain('TODO(assurly)');
  });

  it('sorts the migration after sequential and timestamp naming, matching extension', () => {
    // ".up.sql" convention preserved; 99999999999999 > 003 and > 20260101000000.
    expect(resolveRlsMigrationTarget('db/migrations/003_x.up.sql')).toBe(
      'db/migrations/99999999999999_assurly_enable_rls.up.sql',
    );
    // Plain ".sql" convention preserved; no directory prefix.
    expect(resolveRlsMigrationTarget('schema.sql')).toBe('99999999999999_assurly_enable_rls.sql');
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
      'supabase/99999999999999_assurly_enable_rls.sql',
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

  it('redirects RLS findings to a new migration file', () => {
    expect(
      resolveFindingAutoFixTargetPath({
        file_path: 'db/schema.sql',
        message: "Supabase table 'users' is created but Row-Level Security (RLS) is not enabled.",
      }),
    ).toBe('db/99999999999999_assurly_enable_rls.sql');
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
    expect(summary.prDescription).toContain('`supabase/99999999999999_assurly_enable_rls.sql`');
    expect(summary.prDescription).toContain('`apps/web/.env.example`');
  });
});
