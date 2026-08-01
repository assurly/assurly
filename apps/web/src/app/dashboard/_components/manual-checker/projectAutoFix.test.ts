import { describe, expect, it } from 'vitest';
import {
  applyAllFixableFindingsToProject,
  applyEnvVarsToExampleFiles,
  appendRlsFix,
  countFixableFindings,
  isManualFindingFixable,
} from './projectAutoFix';
import type { ProjectFile } from './useManualScan';
import type { WebFinding } from '../../../../utils/browserScanner';

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

function envFinding(varName: string, file: string, line: number): WebFinding {
  return {
    ruleId: 'undocumented-env',
    severity: 'warning',
    file,
    line,
    message: `Environment variable 'process.env.${varName}' is used but not documented in '.env.example'.`,
    suggestion: `Add ${varName}= to .env.example.`,
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
});
