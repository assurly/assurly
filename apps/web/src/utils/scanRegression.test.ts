import { describe, expect, it } from 'vitest';
import type { ScanFinding } from './dbAdapter';
import { detectNewBlockers, detectRegressions } from './scanRegression';

function finding(
  partial: Partial<ScanFinding> & Pick<ScanFinding, 'rule_id' | 'file_path'>,
): ScanFinding {
  return {
    id: partial.id ?? 'finding-1',
    scan_id: partial.scan_id ?? 'scan-1',
    severity: partial.severity ?? 'error',
    line_number: partial.line_number ?? 1,
    message: partial.message ?? 'Issue detected',
    created_at: partial.created_at ?? '2026-01-01T00:00:00.000Z',
    ...partial,
  };
}

describe('detectRegressions', () => {
  it('returns only findings present in current but not previous', () => {
    const previous = [
      finding({ id: 'a', rule_id: 'rls-missing', file_path: 'db.sql', line_number: 4 }),
    ];
    const current = [
      finding({ id: 'a', rule_id: 'rls-missing', file_path: 'db.sql', line_number: 4 }),
      finding({ id: 'b', rule_id: 'env-leak', file_path: 'app.ts', line_number: 12 }),
    ];

    expect(detectRegressions(previous, current)).toEqual([current[1]]);
  });

  it('returns an empty array when inputs are identical', () => {
    const findings = [
      finding({ id: 'a', rule_id: 'rls-missing', file_path: 'db.sql', line_number: 4 }),
      finding({ id: 'b', rule_id: 'env-leak', file_path: 'app.ts', line_number: 12 }),
    ];

    expect(detectRegressions(findings, findings)).toEqual([]);
  });

  it('treats rule, file, and line as the regression key', () => {
    const previous = [finding({ rule_id: 'rls-missing', file_path: 'db.sql', line_number: 4 })];
    const movedLine = [
      finding({ id: 'moved', rule_id: 'rls-missing', file_path: 'db.sql', line_number: 8 }),
    ];

    expect(detectRegressions(previous, movedLine)).toEqual(movedLine);
  });

  it('returns all current findings when previous is empty', () => {
    const current = [
      finding({ id: 'a', rule_id: 'rls-missing', file_path: 'db.sql' }),
      finding({ id: 'b', rule_id: 'env-leak', file_path: 'app.ts', line_number: 2 }),
    ];

    expect(detectRegressions([], current)).toEqual(current);
  });

  it('returns an empty array when current is empty', () => {
    const previous = [finding({ rule_id: 'rls-missing', file_path: 'db.sql' })];
    expect(detectRegressions(previous, [])).toEqual([]);
  });
});

describe('detectNewBlockers', () => {
  it('includes only new error-severity regressions', () => {
    const previous = [finding({ rule_id: 'rls-missing', file_path: 'db.sql', severity: 'error' })];
    const current = [
      finding({ id: 'old', rule_id: 'rls-missing', file_path: 'db.sql', severity: 'error' }),
      finding({
        id: 'new-blocker',
        rule_id: 'stripe-webhook',
        file_path: 'api/stripe/route.ts',
        severity: 'error',
      }),
      finding({
        id: 'new-warning',
        rule_id: 'env-example',
        file_path: '.env.example',
        severity: 'warning',
      }),
    ];

    expect(detectNewBlockers(previous, current)).toEqual([current[1]]);
  });

  it('excludes new error-severity review findings (medium/low confidence)', () => {
    const current = [
      finding({
        id: 'new-review',
        rule_id: 'rsc-data-leak',
        file_path: 'app/page.tsx',
        severity: 'error',
        confidence: 'medium',
      }),
      finding({
        id: 'new-blocker',
        rule_id: 'supabase-rls',
        file_path: 'db.sql',
        severity: 'error',
        confidence: 'high',
      }),
    ];

    // Only the high-confidence error is a blocker; error+medium is a review item.
    expect(detectNewBlockers([], current)).toEqual([current[1]]);
  });
});
