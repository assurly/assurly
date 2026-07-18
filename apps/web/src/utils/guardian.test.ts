import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ScannerFinding } from '@assurly/scanner-core';
import type { DbAdapter, Target } from './dbAdapter';
import {
  buildBlockerSnapshot,
  readBlockerSnapshot,
  runGuardianCheckForTarget,
  scannerFindingsToScanFindings,
} from './guardian';
import { detectNewBlockers } from './scanRegression';

const notifyMock = vi.hoisted(() => vi.fn());

vi.mock('./scanRegression', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./scanRegression')>();
  return {
    ...actual,
    notifyIfTargetRegressionBlockers: notifyMock,
  };
});

function target(overrides: Partial<Target> = {}): Target {
  return {
    id: 'target-1',
    organization_id: 'org-1',
    kind: 'url',
    identifier: 'https://app.example',
    display_name: 'App',
    repository_id: null,
    generator_fingerprint: 'lovable',
    ownership_verified: true,
    ownership_method: 'meta_tag',
    current_verdict: 'ready',
    current_ship_score: 100,
    verdict_evidence: {
      topIssue: null,
      blockerSnapshot: [],
      previousShipScore: null,
    },
    last_checked_at: '2026-07-17T10:00:00.000Z',
    badge_token: 'a'.repeat(32),
    created_at: '2026-07-16T00:00:00Z',
    updated_at: '2026-07-16T00:00:00Z',
    ...overrides,
  };
}

function rlsFinding(): ScannerFinding {
  return {
    ruleId: 'runtime-supabase-rls-open',
    severity: 'error',
    confidence: 'high',
    message: 'RLS open on users',
    file: 'runtime',
  };
}

describe('blocker snapshot helpers', () => {
  it('round-trips blocker snapshots for regression diffs', () => {
    const findings = scannerFindingsToScanFindings([rlsFinding()]);
    const snapshot = buildBlockerSnapshot(findings);
    const restored = readBlockerSnapshot({ blockerSnapshot: snapshot });
    expect(restored).toHaveLength(1);
    expect(restored[0].rule_id).toBe('runtime-supabase-rls-open');
  });
});

describe('runGuardianCheckForTarget', () => {
  const scanImpl = vi.fn();
  const upsertTarget = vi.fn();
  const getFixOutcomesForTarget = vi.fn().mockResolvedValue([]);
  const insertFixOutcomes = vi.fn();
  const getOrganizationAdminEmails = vi.fn().mockResolvedValue(['owner@example.com']);
  const getTargetAlertPrefs = vi.fn().mockResolvedValue([]);

  const db = {
    upsertTarget,
    getFixOutcomesForTarget,
    insertFixOutcomes,
    getOrganizationAdminEmails,
    getTargetAlertPrefs,
  } as unknown as DbAdapter;

  beforeEach(() => {
    vi.clearAllMocks();
    getFixOutcomesForTarget.mockResolvedValue([]);
    upsertTarget.mockResolvedValue(target());
    notifyMock.mockImplementation(async (_db, _t, prev, cur) => {
      const newBlockers = detectNewBlockers(prev, cur);
      return { alerted: newBlockers.length > 0, newBlockers };
    });
  });

  it('skips an unverified url target with ZERO probe requests', async () => {
    const result = await runGuardianCheckForTarget({
      db,
      target: target({ ownership_verified: false }),
      scanImpl,
    });

    expect(result.skipped).toBe(true);
    expect(result.skipReason).toBe('ownership_gate');
    expect(scanImpl).not.toHaveBeenCalled();
    expect(upsertTarget).not.toHaveBeenCalled();
    expect(notifyMock).not.toHaveBeenCalled();
  });

  it('alerts exactly once on a new blocker vs the previous baseline', async () => {
    scanImpl.mockResolvedValue({ findings: [rlsFinding()], evidence: [] });

    const result = await runGuardianCheckForTarget({
      db,
      target: target({
        verdict_evidence: {
          blockerSnapshot: [],
          previousShipScore: 100,
        },
        last_checked_at: '2026-07-17T10:00:00.000Z',
        current_ship_score: 100,
      }),
      scanImpl,
    });

    expect(result.probed).toBe(true);
    expect(result.alerted).toBe(true);
    expect(result.newBlockerCount).toBe(1);
    expect(notifyMock).toHaveBeenCalledTimes(1);
    expect(upsertTarget).toHaveBeenCalledTimes(1);
  });

  it('produces ZERO alerts when findings are unchanged (fatigue rule)', async () => {
    const previous = buildBlockerSnapshot(scannerFindingsToScanFindings([rlsFinding()]));
    scanImpl.mockResolvedValue({ findings: [rlsFinding()], evidence: [] });

    const result = await runGuardianCheckForTarget({
      db,
      target: target({
        verdict_evidence: { blockerSnapshot: previous, previousShipScore: 80 },
        current_ship_score: 80,
        current_verdict: 'blocked',
        last_checked_at: '2026-07-17T10:00:00.000Z',
      }),
      scanImpl,
    });

    expect(result.alerted).toBe(false);
    expect(result.newBlockerCount).toBe(0);
    expect(notifyMock).toHaveBeenCalledTimes(1);
  });

  it('produces ZERO alerts when a finding was newly fixed', async () => {
    const previous = buildBlockerSnapshot(scannerFindingsToScanFindings([rlsFinding()]));
    scanImpl.mockResolvedValue({ findings: [], evidence: [] });

    const result = await runGuardianCheckForTarget({
      db,
      target: target({
        verdict_evidence: { blockerSnapshot: previous, previousShipScore: 80 },
        current_ship_score: 80,
        last_checked_at: '2026-07-17T10:00:00.000Z',
      }),
      scanImpl,
    });

    expect(result.alerted).toBe(false);
    expect(result.newBlockerCount).toBe(0);
  });

  it('establishes a baseline with ZERO alerts on the first check', async () => {
    scanImpl.mockResolvedValue({ findings: [rlsFinding()], evidence: [] });

    const result = await runGuardianCheckForTarget({
      db,
      target: target({
        last_checked_at: null,
        verdict_evidence: null,
        current_ship_score: null,
      }),
      scanImpl,
    });

    expect(result.alerted).toBe(false);
    expect(notifyMock).not.toHaveBeenCalled();
    expect(upsertTarget).toHaveBeenCalledTimes(1);
  });
});
