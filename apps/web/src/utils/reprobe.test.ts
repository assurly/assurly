import { describe, expect, it, vi } from 'vitest';
import type { ScannerFinding } from '@assurly/scanner-core';
import type { DbAdapter, FixOutcomeRow, Target } from './dbAdapter';
import { recordReprobeOutcomes, reprobeTargetAndRecord, resolveProbeUrl } from './reprobe';

function target(overrides: Partial<Target> = {}): Target {
  return {
    id: 'target-1',
    organization_id: 'org-1',
    kind: 'url',
    identifier: 'https://app.example',
    display_name: null,
    repository_id: null,
    generator_fingerprint: 'lovable',
    ownership_verified: true,
    ownership_method: null,
    current_verdict: null,
    current_ship_score: null,
    verdict_evidence: null,
    last_checked_at: null,
    badge_token: null,
    created_at: '2026-07-16T00:00:00Z',
    updated_at: '2026-07-16T00:00:00Z',
    ...overrides,
  };
}

function historyRow(overrides: Partial<FixOutcomeRow>): FixOutcomeRow {
  return {
    id: 'fo-1',
    organization_id: 'org-1',
    target_id: 'target-1',
    scan_id: null,
    finding_rule_id: 'runtime-supabase-rls-open',
    generator_fingerprint: 'lovable',
    fix_strategy: null,
    outcome: 'still_open',
    pr_url: null,
    deploy_id: null,
    created_at: '2026-07-16T10:00:00Z',
    ...overrides,
  };
}

function rlsFinding(): ScannerFinding {
  return { ruleId: 'runtime-supabase-rls-open', severity: 'error', message: 'RLS open' };
}

function makeDb(history: FixOutcomeRow[]) {
  return {
    getFixOutcomesForTarget: vi.fn().mockResolvedValue(history),
    insertFixOutcomes: vi.fn().mockResolvedValue(undefined),
  } as unknown as DbAdapter & {
    getFixOutcomesForTarget: ReturnType<typeof vi.fn>;
    insertFixOutcomes: ReturnType<typeof vi.fn>;
  };
}

describe('resolveProbeUrl', () => {
  it('returns the identifier for a url target and null for a repo target', () => {
    expect(resolveProbeUrl(target())).toBe('https://app.example');
    expect(resolveProbeUrl(target({ kind: 'repo', identifier: 'owner/repo' }))).toBeNull();
  });
});

describe('recordReprobeOutcomes', () => {
  it('writes a baseline still_open on the first observation of an open finding', async () => {
    const db = makeDb([]);
    const outcomes = await recordReprobeOutcomes({
      db,
      target: target(),
      findings: [rlsFinding()],
    });

    expect(outcomes).toEqual([{ ruleId: 'runtime-supabase-rls-open', outcome: 'still_open' }]);
    expect(db.insertFixOutcomes).toHaveBeenCalledTimes(1);
    expect(db.insertFixOutcomes).toHaveBeenCalledWith([
      expect.objectContaining({
        organizationId: 'org-1',
        targetId: 'target-1',
        findingRuleId: 'runtime-supabase-rls-open',
        generatorFingerprint: 'lovable',
        outcome: 'still_open',
        deployId: null,
      }),
    ]);
  });

  it('flips a previously-open finding to verified_fixed when it is gone', async () => {
    const db = makeDb([historyRow({ outcome: 'still_open' })]);
    const outcomes = await recordReprobeOutcomes({
      db,
      target: target(),
      findings: [],
      deployId: 'dpl_1',
    });

    expect(outcomes).toEqual([{ ruleId: 'runtime-supabase-rls-open', outcome: 'verified_fixed' }]);
    expect(db.insertFixOutcomes).toHaveBeenCalledWith([
      expect.objectContaining({ outcome: 'verified_fixed', deployId: 'dpl_1' }),
    ]);
  });

  it('does not write a duplicate row when a still-open finding is still open', async () => {
    const db = makeDb([historyRow({ outcome: 'still_open' })]);
    const outcomes = await recordReprobeOutcomes({
      db,
      target: target(),
      findings: [rlsFinding()],
    });

    expect(outcomes).toEqual([]);
    expect(db.insertFixOutcomes).not.toHaveBeenCalled();
  });

  it('records a regression when a verified-fixed finding reappears', async () => {
    const db = makeDb([historyRow({ outcome: 'verified_fixed' })]);
    const outcomes = await recordReprobeOutcomes({
      db,
      target: target(),
      findings: [rlsFinding()],
      deployId: 'dpl_2',
    });

    expect(outcomes).toEqual([{ ruleId: 'runtime-supabase-rls-open', outcome: 'regressed' }]);
    expect(db.insertFixOutcomes).toHaveBeenCalledWith([
      expect.objectContaining({ outcome: 'regressed', deployId: 'dpl_2' }),
    ]);
  });
});

describe('reprobeTargetAndRecord (gate)', () => {
  it('fails closed for an unverified url target: passive scan only, nothing recorded', async () => {
    const db = makeDb([]);
    const scanImpl = vi.fn().mockResolvedValue({ findings: [rlsFinding()], evidence: [] });
    const result = await reprobeTargetAndRecord({
      target: target({ ownership_verified: false }),
      db,
      scanImpl: scanImpl as never,
    });

    // The gate is passed straight to the scanner (activeProbe=false), so the
    // active branch never runs; and NOTHING is recorded — nothing is verified
    // without proven ownership.
    expect(scanImpl).toHaveBeenCalledWith(
      'https://app.example',
      expect.anything(),
      undefined,
      expect.objectContaining({ activeProbe: false }),
    );
    expect(result.activeProbe).toBe(false);
    expect(result.probed).toBe(false);
    expect(db.getFixOutcomesForTarget).not.toHaveBeenCalled();
    expect(db.insertFixOutcomes).not.toHaveBeenCalled();
  });

  it('does not re-probe a repo target that has no live URL', async () => {
    const db = makeDb([]);
    const scanImpl = vi.fn();
    const result = await reprobeTargetAndRecord({
      target: target({ kind: 'repo', identifier: 'owner/repo' }),
      db,
      scanImpl: scanImpl as never,
    });

    expect(result.probed).toBe(false);
    expect(result.probeUrl).toBeNull();
    expect(scanImpl).not.toHaveBeenCalled();
  });

  it('probes a verified url target and records outcomes', async () => {
    const db = makeDb([]);
    const scanImpl = vi.fn().mockResolvedValue({ findings: [rlsFinding()], evidence: [] });
    const result = await reprobeTargetAndRecord({
      target: target(),
      db,
      deployId: 'dpl_9',
      scanImpl: scanImpl as never,
    });

    expect(scanImpl).toHaveBeenCalledWith(
      'https://app.example',
      expect.anything(),
      undefined,
      expect.objectContaining({ activeProbe: true, organizationId: 'org-1' }),
    );
    expect(result.probed).toBe(true);
    expect(result.outcomes).toEqual([
      { ruleId: 'runtime-supabase-rls-open', outcome: 'still_open' },
    ]);
    expect(db.insertFixOutcomes).toHaveBeenCalledTimes(1);
  });
});
