import { describe, expect, it, vi } from 'vitest';
import type { DbAdapter, FixOutcomeRow, Target } from './dbAdapter';
import {
  PROGRAMMATIC_FIX_OUTCOME_KEYS,
  PROGRAMMATIC_VERDICT_KEYS,
  resolveProgrammaticVerdict,
  toProgrammaticFixOutcomes,
} from './programmaticVerdict';

const BASE = 'https://assurly.dev';

function target(overrides: Partial<Target> = {}): Target {
  return {
    id: 'target-1',
    organization_id: 'org-1',
    kind: 'url',
    identifier: 'https://app.example.com',
    display_name: 'Example app',
    repository_id: null,
    generator_fingerprint: 'lovable',
    ownership_verified: true,
    ownership_method: 'meta_tag',
    current_verdict: 'blocked',
    current_ship_score: 80,
    // topIssue.key names the exact table internally; the public projection must
    // collapse it to a coarse category and NEVER leak the table name.
    verdict_evidence: { topIssue: { key: 'rls:invoices', severity: 'error' } },
    last_checked_at: '2026-07-18T06:00:00.000Z',
    badge_token: 'a'.repeat(32),
    created_at: '2026-07-01T00:00:00.000Z',
    updated_at: '2026-07-18T06:00:00.000Z',
    ...overrides,
  };
}

function fixOutcome(overrides: Partial<FixOutcomeRow> = {}): FixOutcomeRow {
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
    created_at: '2026-07-18T06:00:00.000Z',
    ...overrides,
  };
}

function db(
  getTargetByIdentifier: DbAdapter['getTargetByIdentifier'],
  getFixOutcomesForTarget: DbAdapter['getFixOutcomesForTarget'] = vi.fn().mockResolvedValue([]),
): Pick<DbAdapter, 'getTargetByIdentifier' | 'getFixOutcomesForTarget'> {
  return { getTargetByIdentifier, getFixOutcomesForTarget };
}

describe('toProgrammaticFixOutcomes', () => {
  it('keeps the newest observation per rule and drops older history', () => {
    const projected = toProgrammaticFixOutcomes([
      fixOutcome({
        id: 'fo-old',
        finding_rule_id: 'runtime-supabase-rls-open',
        outcome: 'still_open',
        created_at: '2026-07-17T00:00:00.000Z',
      }),
      fixOutcome({
        id: 'fo-new',
        finding_rule_id: 'runtime-supabase-rls-open',
        outcome: 'verified_fixed',
        created_at: '2026-07-18T12:00:00.000Z',
      }),
      fixOutcome({
        id: 'fo-secret',
        finding_rule_id: 'runtime-secret-in-bundle',
        outcome: 'regressed',
        created_at: '2026-07-18T08:00:00.000Z',
      }),
    ]);

    expect(projected).toEqual([
      {
        ruleId: 'runtime-secret-in-bundle',
        outcome: 'regressed',
        observedAt: '2026-07-18T08:00:00.000Z',
      },
      {
        ruleId: 'runtime-supabase-rls-open',
        outcome: 'verified_fixed',
        observedAt: '2026-07-18T12:00:00.000Z',
      },
    ]);
  });
});

describe('resolveProgrammaticVerdict', () => {
  it('projects an owned, ownership-verified url target (active probe permitted)', async () => {
    const lookup = vi.fn().mockResolvedValue(target());
    const result = await resolveProgrammaticVerdict(
      db(lookup),
      'org-1',
      { kind: 'url', identifier: 'https://app.example.com' },
      BASE,
    );

    expect(lookup).toHaveBeenCalledWith('org-1', 'url', 'https://app.example.com');
    expect(result.status).toBe('blocked');
    expect(result.shipScore).toBe(80);
    expect(result.activeProbeAllowed).toBe(true);
    expect(result.topIssue?.category).toBe('Database access control (RLS)');
    expect(result.topIssue?.remediation).toMatch(/Row-Level Security/i);
    expect(result.trustPageUrl).toBe(`${BASE}/report/${'a'.repeat(32)}`);
    expect(result.badgeUrl).toBe(`${BASE}/api/badge/${'a'.repeat(32)}`);
    expect(result.fixOutcomes).toEqual([]);
  });

  it('never leaks the exposed table name (shape-only category)', async () => {
    const result = await resolveProgrammaticVerdict(
      db(vi.fn().mockResolvedValue(target())),
      'org-1',
      { kind: 'url', identifier: 'https://app.example.com' },
      BASE,
    );
    expect(JSON.stringify(result)).not.toContain('invoices');
    expect(Object.keys(result).sort()).toEqual([...PROGRAMMATIC_VERDICT_KEYS].sort());
  });

  it('surfaces all three fix outcomes with observation times (shape-only)', async () => {
    const history = [
      fixOutcome({
        id: 'fo-a',
        finding_rule_id: 'runtime-supabase-rls-open',
        outcome: 'verified_fixed',
        created_at: '2026-07-18T10:00:00.000Z',
        // Poison fields that must NEVER reach the programmatic payload.
        fix_strategy: 'enable-rls-on-invoices',
        pr_url: 'https://github.com/acme/app/pull/12',
      }),
      fixOutcome({
        id: 'fo-b',
        finding_rule_id: 'runtime-secret-in-bundle',
        outcome: 'still_open',
        created_at: '2026-07-18T09:00:00.000Z',
      }),
      fixOutcome({
        id: 'fo-c',
        finding_rule_id: 'runtime-missing-security-headers',
        outcome: 'regressed',
        created_at: '2026-07-18T08:00:00.000Z',
      }),
    ];
    const getFixOutcomesForTarget = vi.fn().mockResolvedValue(history);
    const result = await resolveProgrammaticVerdict(
      db(vi.fn().mockResolvedValue(target()), getFixOutcomesForTarget),
      'org-1',
      { kind: 'url', identifier: 'https://app.example.com' },
      BASE,
    );

    expect(getFixOutcomesForTarget).toHaveBeenCalledWith('target-1');
    expect(result.fixOutcomes).toEqual([
      {
        ruleId: 'runtime-missing-security-headers',
        outcome: 'regressed',
        observedAt: '2026-07-18T08:00:00.000Z',
      },
      {
        ruleId: 'runtime-secret-in-bundle',
        outcome: 'still_open',
        observedAt: '2026-07-18T09:00:00.000Z',
      },
      {
        ruleId: 'runtime-supabase-rls-open',
        outcome: 'verified_fixed',
        observedAt: '2026-07-18T10:00:00.000Z',
      },
    ]);

    // Shape-only: each entry is exactly the allowlisted keys — no messages,
    // file paths, table names, PR URLs, or fix strategies.
    for (const entry of result.fixOutcomes) {
      expect(Object.keys(entry).sort()).toEqual([...PROGRAMMATIC_FIX_OUTCOME_KEYS].sort());
    }
    const serialized = JSON.stringify(result.fixOutcomes);
    expect(serialized).not.toContain('invoices');
    expect(serialized).not.toContain('enable-rls');
    expect(serialized).not.toContain('github.com');
    expect(serialized).not.toContain('Supabase table');
    expect(serialized).not.toContain('/src/');
    expect(serialized).not.toContain('message');
  });

  it('returns an empty fixOutcomes array when the target has no outcome history', async () => {
    const getFixOutcomesForTarget = vi.fn().mockResolvedValue([]);
    const result = await resolveProgrammaticVerdict(
      db(vi.fn().mockResolvedValue(target()), getFixOutcomesForTarget),
      'org-1',
      { kind: 'url', identifier: 'https://app.example.com' },
      BASE,
    );
    expect(result.fixOutcomes).toEqual([]);
    expect(getFixOutcomesForTarget).toHaveBeenCalledTimes(1);
  });

  it('returns the PASSIVE verdict for an owned-but-unverified url (active probe not allowed)', async () => {
    const result = await resolveProgrammaticVerdict(
      db(vi.fn().mockResolvedValue(target({ ownership_verified: false }))),
      'org-1',
      { kind: 'url', identifier: 'https://app.example.com' },
      BASE,
    );
    // Still the stored verdict — but the gate reports active probing is not allowed.
    expect(result.status).toBe('blocked');
    expect(result.activeProbeAllowed).toBe(false);
  });

  it('allows active probing for a repo target (implicitly owned)', async () => {
    const result = await resolveProgrammaticVerdict(
      db(vi.fn().mockResolvedValue(target({ kind: 'repo', identifier: 'acme/api' }))),
      'org-1',
      { kind: 'repo', identifier: 'acme/api' },
      BASE,
    );
    expect(result.activeProbeAllowed).toBe(true);
  });

  it('returns an unknown, passive verdict for a target the org does not own', async () => {
    const lookup = vi.fn().mockResolvedValue(null);
    const getFixOutcomesForTarget = vi.fn().mockResolvedValue([]);
    const result = await resolveProgrammaticVerdict(
      db(lookup, getFixOutcomesForTarget),
      'org-1',
      { kind: 'url', identifier: 'https://stranger.example.com' },
      BASE,
    );
    expect(result.status).toBe('unknown');
    expect(result.shipScore).toBeNull();
    expect(result.topIssue).toBeNull();
    expect(result.fixOutcomes).toEqual([]);
    expect(result.activeProbeAllowed).toBe(false);
    expect(result.trustPageUrl).toBeNull();
    // Scoped target read only — never enumerates outcomes for a stranger, never probes.
    expect(lookup).toHaveBeenCalledTimes(1);
    expect(getFixOutcomesForTarget).not.toHaveBeenCalled();
  });
});
