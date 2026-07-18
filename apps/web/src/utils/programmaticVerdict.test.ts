import { describe, expect, it, vi } from 'vitest';
import type { DbAdapter, Target } from './dbAdapter';
import { PROGRAMMATIC_VERDICT_KEYS, resolveProgrammaticVerdict } from './programmaticVerdict';

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

function db(
  getTargetByIdentifier: DbAdapter['getTargetByIdentifier'],
): Pick<DbAdapter, 'getTargetByIdentifier'> {
  return { getTargetByIdentifier };
}

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
    const result = await resolveProgrammaticVerdict(
      db(lookup),
      'org-1',
      { kind: 'url', identifier: 'https://stranger.example.com' },
      BASE,
    );
    expect(result.status).toBe('unknown');
    expect(result.shipScore).toBeNull();
    expect(result.topIssue).toBeNull();
    expect(result.activeProbeAllowed).toBe(false);
    expect(result.trustPageUrl).toBeNull();
    // The ONLY DB access is a single scoped read — no probe/scan/re-probe path exists.
    expect(lookup).toHaveBeenCalledTimes(1);
  });
});
