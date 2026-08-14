import { describe, expect, it } from 'vitest';
import {
  clampShipScoreForCoverage,
  indicatesIncompleteCoverage,
  INCOMPLETE_NO_BLOCKER_FLOOR,
  INCOMPLETE_SCORE_CAP,
  resolveDisplayedShipScore,
} from './shipScoreDisplay';

const incompleteFinding = {
  id: 'f1',
  scan_id: 's1',
  rule_id: 'scan-completeness',
  severity: 'warning' as const,
  confidence: 'high' as const,
  file_path: 'unknown',
  line_number: 1,
  message: 'incomplete',
  suggestion: '',
  created_at: '2026-01-01T00:00:00.000Z',
};

describe('indicatesIncompleteCoverage', () => {
  it('detects scan-completeness key and incomplete labels', () => {
    expect(indicatesIncompleteCoverage({ topIssueKey: 'rule:scan-completeness' })).toBe(true);
    expect(indicatesIncompleteCoverage({ topIssueLabel: 'Scan is incomplete' })).toBe(true);
    expect(indicatesIncompleteCoverage({ findingRuleIds: ['scan-completeness'] })).toBe(true);
    expect(indicatesIncompleteCoverage({ topIssueKey: 'rule:rls-missing' })).toBe(false);
  });
});

describe('clampShipScoreForCoverage', () => {
  it('caps incomplete scores and leaves complete scores alone', () => {
    expect(clampShipScoreForCoverage(92, true)).toBe(INCOMPLETE_SCORE_CAP);
    expect(clampShipScoreForCoverage(92, false)).toBe(92);
    expect(clampShipScoreForCoverage(null, true)).toBeNull();
  });

  it('floors incomplete scores without blockers', () => {
    expect(clampShipScoreForCoverage(0, true)).toBe(INCOMPLETE_NO_BLOCKER_FLOOR);
    expect(clampShipScoreForCoverage(0, true, { hasBlockers: true })).toBe(0);
  });
});

describe('resolveDisplayedShipScore', () => {
  it('prefers persisted ship_score when complete', () => {
    expect(resolveDisplayedShipScore({ ship_score: 96, scanned_file_count: 10 }, [])).toBe(96);
  });

  it('recomputes incomplete coverage through the engine (cap + no-blocker floor)', () => {
    const manyWarnings = Array.from({ length: 30 }, (_, index) => ({
      id: `w-${index}`,
      scan_id: 's1',
      rule_id: `env-${index}`,
      severity: 'warning' as const,
      confidence: 'high' as const,
      file_path: `file-${index}.ts`,
      line_number: 1,
      message: `warn ${index}`,
      suggestion: '',
      created_at: '2026-01-01T00:00:00.000Z',
    }));
    const score = resolveDisplayedShipScore({ ship_score: 0, scanned_file_count: 250 }, [
      incompleteFinding,
      ...manyWarnings,
    ]);
    expect(score).toBeGreaterThanOrEqual(INCOMPLETE_NO_BLOCKER_FLOOR);
    expect(score).toBeLessThanOrEqual(INCOMPLETE_SCORE_CAP);
  });

  it('caps a high persisted incomplete score when only completeness findings exist', () => {
    expect(
      resolveDisplayedShipScore({ ship_score: 92, scanned_file_count: 250 }, [incompleteFinding]),
    ).toBeLessThanOrEqual(INCOMPLETE_SCORE_CAP);
  });
});
