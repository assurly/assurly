import { describe, expect, it } from 'vitest';
import { dedupeScanFindingsForDisplay } from './scanFindingsDisplay';
import type { ScanFinding } from './dbAdapter';

const baseFinding: Omit<ScanFinding, 'id' | 'file_path' | 'line_number'> = {
  scan_id: 'scan-1',
  rule_id: 'undocumented-env',
  severity: 'error',
  message:
    "Environment variable 'process.env.NEXT_PUBLIC_SENTRY_DSN' is used but not documented in '.env.example'.",
  suggestion: 'Add NEXT_PUBLIC_SENTRY_DSN= to .env.example.',
  created_at: '2026-06-26T09:52:00Z',
};

function buildFinding(id: string, overrides: Partial<ScanFinding> = {}): ScanFinding {
  return {
    ...baseFinding,
    id,
    file_path: `src/${id}.tsx`,
    line_number: 1,
    ...overrides,
  };
}

describe('dedupeScanFindingsForDisplay', () => {
  it('merges repeated env findings into one representative with occurrence count', () => {
    const findings = [
      buildFinding('finding-a'),
      buildFinding('finding-b', { file_path: 'src/other.ts', line_number: 4 }),
      buildFinding('finding-c', { file_path: 'src/third.ts', line_number: 9 }),
    ];

    const deduped = dedupeScanFindingsForDisplay(findings);

    expect(deduped).toHaveLength(1);
    expect(deduped[0]?.id).toBe('finding-a');
    expect(deduped[0]?.occurrenceCount).toBe(3);
  });

  it('keeps distinct groups separate even when rule_id matches', () => {
    const findings = [
      buildFinding('finding-a'),
      buildFinding('finding-b', {
        message:
          "Environment variable 'process.env.STRIPE_SECRET_KEY' is used but not documented in '.env.example'.",
      }),
      buildFinding('finding-c', {
        rule_id: 'supabase-rls',
        message: "Supabase table 'users' is created but Row-Level Security (RLS) is not enabled.",
      }),
    ];

    const deduped = dedupeScanFindingsForDisplay(findings);

    expect(deduped).toHaveLength(3);
    expect(deduped.map((finding) => finding.occurrenceCount)).toEqual([1, 1, 1]);
  });

  it('preserves first-seen order of unique groups', () => {
    const findings = [
      buildFinding('finding-rls', {
        rule_id: 'supabase-rls',
        message: "Supabase table 'users' is created but Row-Level Security (RLS) is not enabled.",
      }),
      buildFinding('finding-env-a'),
      buildFinding('finding-env-b'),
    ];

    const deduped = dedupeScanFindingsForDisplay(findings);

    expect(deduped.map((finding) => finding.id)).toEqual(['finding-rls', 'finding-env-a']);
    expect(deduped[1]?.occurrenceCount).toBe(2);
  });

  it('returns an empty list unchanged', () => {
    expect(dedupeScanFindingsForDisplay([])).toEqual([]);
  });
});
