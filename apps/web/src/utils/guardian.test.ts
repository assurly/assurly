import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ScannerFinding } from '@assurly/scanner-core';
import type { DbAdapter, Target } from './dbAdapter';
import {
  buildBlockerSnapshot,
  persistUrlTargetShipGateVerdict,
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

describe('persistUrlTargetShipGateVerdict', () => {
  it('writes ready verdict and lastCheckedAt for a clean passive scan', async () => {
    const upsertTarget = vi.fn().mockResolvedValue({});
    const db = { upsertTarget } as unknown as DbAdapter;
    const fixedNow = new Date('2026-07-29T12:00:00.000Z');

    await persistUrlTargetShipGateVerdict({
      db,
      organizationId: 'org-1',
      identifier: 'https://github.com',
      findings: [],
      previous: { current_ship_score: null, badge_token: null },
      now: () => fixedNow,
    });

    expect(upsertTarget).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: 'org-1',
        kind: 'url',
        identifier: 'https://github.com',
        currentVerdict: 'ready',
        currentShipScore: 100,
        lastCheckedAt: '2026-07-29T12:00:00.000Z',
        badgeToken: expect.any(String),
      }),
    );
  });

  it('writes blocked verdict when high-confidence errors are present', async () => {
    const upsertTarget = vi.fn().mockResolvedValue({});
    const db = { upsertTarget } as unknown as DbAdapter;

    await persistUrlTargetShipGateVerdict({
      db,
      organizationId: 'org-1',
      identifier: 'https://app.example',
      findings: [rlsFinding()],
      previous: { current_ship_score: 100, badge_token: 'b'.repeat(32) },
    });

    expect(upsertTarget).toHaveBeenCalledWith(
      expect.objectContaining({
        currentVerdict: 'blocked',
        badgeToken: 'b'.repeat(32),
      }),
    );
  });

  it('swallows persistence failures so the scan response is never failed', async () => {
    const upsertTarget = vi.fn().mockRejectedValue(new Error('db down'));
    const db = { upsertTarget } as unknown as DbAdapter;

    await expect(
      persistUrlTargetShipGateVerdict({
        db,
        organizationId: 'org-1',
        identifier: 'https://app.example',
        findings: [],
      }),
    ).resolves.toBeUndefined();
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
