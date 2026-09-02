import { describe, expect, it } from 'vitest';
import { readScanScopeTotals } from './scanScopeTotals';

describe('readScanScopeTotals', () => {
  it('reads the repository counts the server measured', () => {
    expect(
      readScanScopeTotals({
        tree: [{ path: 'apps/web/src/a.ts', type: 'blob' }],
        totals: { sourceTotal: 4213, surfaceSource: 4100, surfaceAnalyzable: 4000 },
      }),
    ).toEqual({ sourceTotal: 4213, surfaceSource: 4100, surfaceAnalyzable: 4000 });
  });

  it('carries the floor flag when GitHub truncated its own tree', () => {
    expect(
      readScanScopeTotals({
        totals: { sourceTotal: 5, surfaceSource: 4, surfaceAnalyzable: 3, partial: true },
      })?.partial,
    ).toBe(true);
  });

  /**
   * A cached response from before totals shipped, or a proxy that drops unknown
   * keys, must fall back to the old sample-derived scope rather than crash a scan.
   */
  it('returns undefined rather than guessing when the field is absent or malformed', () => {
    expect(readScanScopeTotals({ tree: [] })).toBeUndefined();
    expect(readScanScopeTotals(null)).toBeUndefined();
    expect(readScanScopeTotals({ totals: { sourceTotal: 5 } })).toBeUndefined();
    expect(
      readScanScopeTotals({ totals: { sourceTotal: -1, surfaceSource: 0, surfaceAnalyzable: 0 } }),
    ).toBeUndefined();
  });

  /** A surface cannot hold more files than the repository it sits in. */
  it('rejects counts that cannot describe one repository', () => {
    expect(
      readScanScopeTotals({ totals: { sourceTotal: 3, surfaceSource: 9, surfaceAnalyzable: 1 } }),
    ).toBeUndefined();
    expect(
      readScanScopeTotals({ totals: { sourceTotal: 9, surfaceSource: 3, surfaceAnalyzable: 7 } }),
    ).toBeUndefined();
  });
});
