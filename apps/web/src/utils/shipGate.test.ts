import { describe, expect, it } from 'vitest';
import {
  buildShipGateFromScanFindings,
  getShipGateActionHint,
  resolveVerdict,
  resolveVerdictFromScanFindings,
} from './shipGate';
import { buildShipGateReport } from '@assurly/scanner-core';
import type { ScanFinding } from './dbAdapter';

function finding(overrides: Partial<ScanFinding>): ScanFinding {
  return {
    id: 'f',
    scan_id: 'scan-1',
    rule_id: 'supabase-rls',
    severity: 'error',
    file_path: 'schema.sql',
    line_number: 1,
    message: "Supabase table 'users' is created but Row-Level Security (RLS) is not enabled.",
    created_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

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
          severity: 'warning',
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
    expect(report.blockers).toHaveLength(1);
    expect(report.blockers[0]?.action?.kind).toBe('hint');
    expect(report.warnings).toHaveLength(1);
    expect(report.warnings[0]?.label).toBe('Undocumented env: STRIPE_SECRET_KEY');
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

describe('getShipGateActionHint', () => {
  it('uses repo copy by default when nothing was scanned', () => {
    const report = buildShipGateReport([], { scannedFileCount: 0, cleanFileCount: 0 });
    expect(getShipGateActionHint(report)).toContain('No scannable application files');
  });

  it('keeps Manual Checker copy when surface is manual', () => {
    const report = buildShipGateReport([], { scannedFileCount: 0, cleanFileCount: 0 });
    expect(getShipGateActionHint(report, { surface: 'manual' })).toBe(
      'Select a folder or ZIP to start',
    );
  });
});

describe('resolveVerdict', () => {
  it('reports "ready" with no top issue for a clean report', () => {
    const verdict = resolveVerdict(
      buildShipGateReport([], { scannedFileCount: 5, cleanFileCount: 5 }),
    );
    expect(verdict.status).toBe('ready');
    expect(verdict.shipScore).toBe(100);
    expect(verdict.topIssue).toBeNull();
    expect(verdict.blockerCount).toBe(0);
  });

  it('surfaces a blocker as the top issue and reports blocked', () => {
    const verdict = resolveVerdictFromScanFindings([finding({ id: '1' })], {
      scannedFileCount: 3,
      cleanFileCount: 2,
    });
    expect(verdict.status).toBe('blocked');
    expect(verdict.headline).toBe('NOT READY TO SHIP');
    expect(verdict.blockerCount).toBe(1);
    expect(verdict.topIssue?.severity).toBe('error');
    expect(verdict.topIssue?.sampleMessage).toMatch(/Row-Level Security/);
  });

  it('prefers a blocker over a warning as the dominant issue', () => {
    const verdict = resolveVerdictFromScanFindings(
      [
        finding({
          id: 'w',
          rule_id: 'github-actions-integration',
          severity: 'warning',
          file_path: 'Global Configs',
          message: 'CI workflow missing',
        }),
        finding({ id: 'b' }),
      ],
      { scannedFileCount: 4, cleanFileCount: 2 },
    );
    // Blocker (RLS) must win over the warning even though the warning was listed first.
    expect(verdict.status).toBe('blocked');
    expect(verdict.topIssue?.severity).toBe('error');
    expect(verdict.topIssue?.sampleMessage).toMatch(/Row-Level Security/);
  });

  it('reports "review" and a warning top issue when there are no blockers', () => {
    const verdict = resolveVerdictFromScanFindings(
      [
        finding({
          id: 'w',
          rule_id: 'github-actions-integration',
          severity: 'warning',
          file_path: 'Global Configs',
          message: 'CI workflow missing',
        }),
      ],
      { scannedFileCount: 4, cleanFileCount: 3 },
    );
    expect(verdict.status).toBe('review');
    expect(verdict.blockerCount).toBe(0);
    expect(verdict.warningCount).toBe(1);
    expect(verdict.topIssue?.severity).toBe('warning');
  });
});
