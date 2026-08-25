import { describe, expect, it } from 'vitest';
import { BLOCKED_SCORE_CAP as ENGINE_BLOCKED_SCORE_CAP } from '@assurly/scanner-core';
import {
  BLOCKED_SCORE_CAP,
  clampShipScoreForBlockedVerdict,
  clampShipScoreForCoverage,
  indicatesIncompleteCoverage,
  INCOMPLETE_NO_BLOCKER_FLOOR,
  INCOMPLETE_SCORE_CAP,
  resolveDisplayedShipScore,
} from './shipScoreDisplay';
import { buildShipGateFromScanFindings } from './shipGate';

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

  it('caps a persisted blocked score so it never looks shippable', () => {
    const blockerFinding = {
      id: 'f-block',
      scan_id: 's1',
      rule_id: 'stripe-webhook-signature',
      severity: 'error' as const,
      confidence: 'high' as const,
      file_path: 'app/api/webhook/route.ts',
      line_number: 1,
      message: 'Stripe webhook endpoint appears to lack signature verification.',
      suggestion: '',
      created_at: '2026-01-01T00:00:00.000Z',
    };
    expect(
      resolveDisplayedShipScore({ ship_score: 88, scanned_file_count: 10 }, [blockerFinding]),
    ).toBeLessThanOrEqual(BLOCKED_SCORE_CAP);
  });
});

describe('card and detail ship-score projections', () => {
  it('agree on the score for the same findings (PHPAuth-style RLS group + warning)', () => {
    const tables = ['attempts', 'config', 'requests', 'sessions', 'users'];
    const findings = [
      ...tables.map((table, index) => ({
        id: `rls-${table}`,
        scan_id: 's1',
        rule_id: 'supabase-rls',
        severity: 'error' as const,
        confidence: 'high' as const,
        file_path: 'database.sql',
        line_number: index + 1,
        message: `Supabase table '${table}' is created but Row-Level Security (RLS) is not enabled.`,
        suggestion: '',
        created_at: '2026-08-09T19:47:28.312Z',
      })),
      {
        id: 'warn-gha',
        scan_id: 's1',
        rule_id: 'github-actions-integration',
        severity: 'warning' as const,
        confidence: 'high' as const,
        file_path: 'Global Configs',
        line_number: 1,
        message: 'GitHub Actions workflow for Assurly is missing.',
        suggestion: '',
        created_at: '2026-08-09T19:47:28.312Z',
      },
    ];
    const scan = { ship_score: null, scanned_file_count: null, clean_file_count: null };
    const detailScore = resolveDisplayedShipScore(scan, findings);
    const cardScore = buildShipGateFromScanFindings(findings).shipScore;

    expect(detailScore).toBe(cardScore);
    expect(detailScore).toBe(ENGINE_BLOCKED_SCORE_CAP);
    // The pre-group raw formula (5 blockers × 12 + 1 warning × 4) must not reappear.
    expect(detailScore).not.toBe(100 - 5 * 12 - 1 * 4);
  });
});

describe('clampShipScoreForBlockedVerdict', () => {
  it('caps blocked scores and leaves unblocked scores alone', () => {
    expect(clampShipScoreForBlockedVerdict(88, true)).toBe(BLOCKED_SCORE_CAP);
    expect(clampShipScoreForBlockedVerdict(88, false)).toBe(88);
    expect(clampShipScoreForBlockedVerdict(null, true)).toBeNull();
  });
});
