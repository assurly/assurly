import { describe, expect, it } from 'vitest';
import { buildShipGateFromScanFindings, getShipGateActionHint } from './shipGate';

describe('shipGate web adapter', () => {
  it('builds a blocked report from scan findings', () => {
    const report = buildShipGateFromScanFindings(
      [
        {
          id: '1',
          scan_id: 'scan-1',
          rule_id: 'supabase-rls',
          severity: 'error',
          file_path: 'schema.sql',
          line_number: 1,
          message: "Supabase table 'users' is created but Row-Level Security (RLS) is not enabled.",
          created_at: '2026-01-01T00:00:00Z',
        },
        {
          id: '2',
          scan_id: 'scan-1',
          rule_id: 'undocumented-env',
          severity: 'error',
          file_path: 'api.ts',
          line_number: 2,
          message:
            "Environment variable 'process.env.STRIPE_SECRET_KEY' is used but not documented in '.env.example'.",
          created_at: '2026-01-01T00:00:00Z',
        },
      ],
      { scannedFileCount: 10, cleanFileCount: 8 },
    );

    expect(report.status).toBe('blocked');
    expect(report.blockers).toHaveLength(2);
    expect(report.blockers[0]?.action?.kind).toBe('hint');
    expect(report.cleanFileCount).toBe(8);
    expect(getShipGateActionHint(report)).toContain('blockers');
  });

  it('maps CI workflow warnings to a assurly init command action', () => {
    const report = buildShipGateFromScanFindings(
      [
        {
          id: '1',
          scan_id: 'scan-1',
          rule_id: 'github-actions-integration',
          severity: 'warning',
          file_path: 'Global Configs',
          line_number: 1,
          message: 'GitHub Actions workflow for Assurly is missing.',
          created_at: '2026-01-01T00:00:00Z',
        },
      ],
      { scannedFileCount: 5, cleanFileCount: 4 },
    );

    expect(report.warnings[0]?.action).toEqual({
      label: 'Initialize CI workflow',
      kind: 'command',
      command: 'npx assurly init',
      hint: undefined,
    });
  });

  it('maps persisted CI workflow findings with a generic rule id back to Initialize CI workflow', () => {
    const report = buildShipGateFromScanFindings(
      [
        {
          id: '1',
          scan_id: 'scan-1',
          rule_id: 'general',
          severity: 'warning',
          file_path: 'Global Configs',
          line_number: 1,
          message: 'GitHub Actions workflow for Assurly is missing.',
          suggestion:
            'Run "npx assurly init" in your repository to automatically configure the CI/CD pipeline.',
          created_at: '2026-01-01T00:00:00Z',
        },
      ],
      { scannedFileCount: 5, cleanFileCount: 4 },
    );

    expect(report.warnings[0]?.action?.label).toBe('Initialize CI workflow');
    expect(report.warnings[0]?.action?.kind).toBe('command');
    expect(report.warnings[0]?.action?.command).toBe('npx assurly init');
  });
});
