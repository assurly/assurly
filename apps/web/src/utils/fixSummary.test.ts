import { describe, expect, it } from 'vitest';
import { summarizeScanFixes } from './fixSummary';
import type { ScanFinding } from './dbAdapter';

function finding(partial: Partial<ScanFinding> & Pick<ScanFinding, 'id'>): ScanFinding {
  return {
    scan_id: 'scan-1',
    rule_id: 'rls',
    severity: 'error',
    file_path: 'database.sql',
    message: "Supabase table 'attempts' is created but Row-Level Security (RLS) is not enabled.",
    created_at: '2026-01-01T00:00:00.000Z',
    ...partial,
  };
}

describe('summarizeScanFixes', () => {
  it('separates upstream issues from proposed fix pull requests', () => {
    const summary = summarizeScanFixes(
      [
        finding({ id: 'f-1', fix_pr_url: 'https://github.com/acme/app/pull/1' }),
        finding({
          id: 'f-2',
          message:
            "Supabase table 'config' is created but Row-Level Security (RLS) is not enabled.",
        }),
      ],
      5,
    );

    expect(summary.blockerCount).toBe(5);
    expect(summary.findingCount).toBe(2);
    expect(summary.fixableCount).toBe(2);
    expect(summary.proposedCount).toBe(1);
    expect(summary.remainingCount).toBe(1);
  });

  it('counts every displayed finding, not only errors', () => {
    const summary = summarizeScanFixes(
      [
        finding({ id: 'f-1' }),
        finding({
          id: 'f-2',
          severity: 'warning',
          rule_id: 'undocumented-env',
          file_path: 'src/lib.ts',
          message:
            "Environment variable 'process.env.STRIPE_SECRET_KEY' is used but not documented in '.env.example'.",
        }),
      ],
      1,
    );

    expect(summary.blockerCount).toBe(1);
    expect(summary.findingCount).toBe(2);
  });

  it('counts duplicate env findings individually so the summary matches persisted warning_count', () => {
    const summary = summarizeScanFixes(
      [
        finding({
          id: 'f-a',
          severity: 'warning',
          rule_id: 'undocumented-env',
          file_path: 'src/a.ts',
          message:
            "Environment variable 'process.env.NEXT_PUBLIC_SENTRY_DSN' is used but not documented in '.env.example'.",
        }),
        finding({
          id: 'f-b',
          severity: 'warning',
          rule_id: 'undocumented-env',
          file_path: 'src/b.ts',
          message:
            "Environment variable 'process.env.NEXT_PUBLIC_SENTRY_DSN' is used but not documented in '.env.example'.",
        }),
        finding({
          id: 'f-c',
          severity: 'warning',
          rule_id: 'undocumented-env',
          file_path: 'src/c.ts',
          message:
            "Environment variable 'process.env.NEXT_PUBLIC_SENTRY_DSN' is used but not documented in '.env.example'.",
        }),
      ],
      0,
    );

    expect(summary.blockerCount).toBe(0);
    expect(summary.findingCount).toBe(3);
  });
});
