import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  authenticateApiKey: vi.fn(),
  getAdminDbAdapter: vi.fn(),
}));

vi.mock('../../../../utils/apiKeys', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../utils/apiKeys')>()),
  authenticateApiKey: mocks.authenticateApiKey,
}));
vi.mock('../../../../utils/dbAdapter', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../utils/dbAdapter')>()),
  getAdminDbAdapter: mocks.getAdminDbAdapter,
}));

import { GET } from './route';
import { resetRateLimitsForTests } from '../../../../utils/rateLimit';
import {
  PROGRAMMATIC_FIX_OUTCOME_KEYS,
  PROGRAMMATIC_VERDICT_KEYS,
} from '../../../../utils/programmaticVerdict';
import type { FixOutcomeRow, Target } from '../../../../utils/dbAdapter';

function target(overrides: Partial<Target> = {}): Target {
  return {
    id: 'target-1',
    organization_id: 'org-1',
    kind: 'url',
    identifier: 'https://app.example.com',
    display_name: 'Example app',
    repository_id: null,
    generator_fingerprint: 'lovable',
    ownership_verified: false,
    ownership_method: null,
    current_verdict: 'blocked',
    current_ship_score: 80,
    verdict_evidence: { topIssue: { key: 'rls:invoices', severity: 'error' } },
    last_checked_at: '2026-07-18T06:00:00.000Z',
    badge_token: 'a'.repeat(32),
    created_at: '2026-07-01T00:00:00.000Z',
    updated_at: '2026-07-18T06:00:00.000Z',
    ...overrides,
  };
}

function useKey(plan: 'free' | 'pro' = 'free'): void {
  mocks.authenticateApiKey.mockResolvedValue({ id: 'key-1', organizationId: 'org-1', plan });
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

function useTarget(
  row: Target | null,
  outcomes: FixOutcomeRow[] = [],
): {
  getTargetByIdentifier: ReturnType<typeof vi.fn>;
  getFixOutcomesForTarget: ReturnType<typeof vi.fn>;
} {
  const getTargetByIdentifier = vi.fn().mockResolvedValue(row);
  const getFixOutcomesForTarget = vi.fn().mockResolvedValue(outcomes);
  mocks.getAdminDbAdapter.mockReturnValue({ getTargetByIdentifier, getFixOutcomesForTarget });
  return { getTargetByIdentifier, getFixOutcomesForTarget };
}

function call(url = 'https://app.example.com'): Promise<Response> {
  return GET(
    new Request(`http://localhost/api/v1/verdict?url=${encodeURIComponent(url)}`, {
      headers: { authorization: 'Bearer ask_live_dummy' },
    }),
  );
}

describe('GET /api/v1/verdict (keyed programmatic verdict)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetRateLimitsForTests();
  });

  it('rejects a missing / malformed / revoked key with 401', async () => {
    mocks.authenticateApiKey.mockResolvedValue(null);
    useTarget(target());
    const res = await call();
    expect(res.status).toBe(401);
  });

  it('returns the shape-only verdict for a valid key', async () => {
    useKey('free');
    const { getTargetByIdentifier } = useTarget(target({ ownership_verified: true }));
    const res = await call();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('blocked');
    expect(body.shipScore).toBe(80);
    expect(body.topIssue.category).toBe('Database access control (RLS)');
    expect(body.activeProbeAllowed).toBe(true);
    expect(body.fixOutcomes).toEqual([]);
    expect(getTargetByIdentifier).toHaveBeenCalledWith('org-1', 'url', 'https://app.example.com');
    // Payload is shape-only: only whitelisted keys, and no leaked table name.
    expect(Object.keys(body).sort()).toEqual([...PROGRAMMATIC_VERDICT_KEYS].sort());
    expect(JSON.stringify(body)).not.toContain('invoices');
  });

  it('returns per-rule fix outcomes without evidence, messages, paths, or table names', async () => {
    useKey('free');
    useTarget(target({ ownership_verified: true }), [
      fixOutcome({
        finding_rule_id: 'runtime-supabase-rls-open',
        outcome: 'verified_fixed',
        created_at: '2026-07-18T10:00:00.000Z',
        fix_strategy: 'enable-rls-on-invoices',
        pr_url: 'https://github.com/acme/app/pull/9',
      }),
      fixOutcome({
        id: 'fo-2',
        finding_rule_id: 'runtime-secret-in-bundle',
        outcome: 'still_open',
        created_at: '2026-07-18T09:00:00.000Z',
      }),
      fixOutcome({
        id: 'fo-3',
        finding_rule_id: 'runtime-missing-security-headers',
        outcome: 'regressed',
        created_at: '2026-07-18T08:00:00.000Z',
      }),
    ]);
    const res = await call();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.fixOutcomes).toEqual([
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
    for (const entry of body.fixOutcomes as Array<Record<string, unknown>>) {
      expect(Object.keys(entry).sort()).toEqual([...PROGRAMMATIC_FIX_OUTCOME_KEYS].sort());
    }
    // Shape-only guard with teeth: finding message / file path / table name must
    // never appear in the fix-outcome payload (mirrors the top-level table guard).
    const serialized = JSON.stringify(body.fixOutcomes);
    expect(serialized).not.toContain('invoices');
    expect(serialized).not.toContain('Supabase table');
    expect(serialized).not.toContain('returned rows');
    expect(serialized).not.toContain('/src/');
    expect(serialized).not.toContain('github.com');
    expect(serialized).not.toContain('message');
  });

  it('returns the PASSIVE verdict and triggers ZERO active probe for an unverified target', async () => {
    useKey('free');
    const { getTargetByIdentifier, getFixOutcomesForTarget } = useTarget(
      target({ ownership_verified: false }),
    );
    const res = await call();
    expect(res.status).toBe(200);
    const body = await res.json();
    // Stored (passive) verdict is returned; active probing is reported not-allowed.
    expect(body.activeProbeAllowed).toBe(false);
    // Side-effect assertion: only pure reads (target + fix outcomes). The admin
    // adapter exposes no probe/scan/re-probe method here, so no active probe is possible.
    expect(getTargetByIdentifier).toHaveBeenCalledTimes(1);
    expect(getFixOutcomesForTarget).toHaveBeenCalledTimes(1);
    const adapter = mocks.getAdminDbAdapter.mock.results[0]?.value as Record<string, unknown>;
    expect(Object.keys(adapter).sort()).toEqual(
      ['getFixOutcomesForTarget', 'getTargetByIdentifier'].sort(),
    );
  });

  it('returns the stored repo verdict when the target has scans but no badge token', async () => {
    useKey('free');
    const { getTargetByIdentifier } = useTarget(
      target({
        kind: 'repo',
        identifier: 'tibco87/PHPAuth',
        display_name: 'tibco87/PHPAuth',
        repository_id: 'a26e03a7-42b0-42be-b2c9-fd685ea177a0',
        current_verdict: 'blocked',
        current_ship_score: 59,
        last_checked_at: '2026-08-09T19:47:28.312Z',
        badge_token: null,
        ownership_verified: false,
      }),
    );
    const res = await GET(
      new Request('http://localhost/api/v1/verdict?repo=tibco87%2FPHPAuth', {
        headers: { authorization: 'Bearer ask_live_dummy' },
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('blocked');
    expect(body.shipScore).toBe(59);
    expect(body.lastCheckedAt).toBe('2026-08-09T19:47:28.312Z');
    expect(body.kind).toBe('repo');
    expect(body.identifier).toBe('tibco87/PHPAuth');
    expect(body.trustPageUrl).toBeNull();
    expect(body.badgeUrl).toBeNull();
    expect(getTargetByIdentifier).toHaveBeenCalledWith('org-1', 'repo', 'tibco87/PHPAuth');
  });

  it('returns unknown for a repository with no stored scan target', async () => {
    useKey('free');
    useTarget(null);
    const res = await GET(
      new Request('http://localhost/api/v1/verdict?repo=acme%2Fnever-scanned', {
        headers: { authorization: 'Bearer ask_live_dummy' },
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('unknown');
    expect(body.shipScore).toBeNull();
    expect(body.lastCheckedAt).toBeNull();
    expect(body.kind).toBe('repo');
    expect(body.identifier).toBe('acme/never-scanned');
  });

  it('returns unknown for a target the org does not own', async () => {
    useKey('free');
    useTarget(null);
    const res = await call('https://stranger.example.com');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('unknown');
    expect(body.activeProbeAllowed).toBe(false);
  });

  it('rejects a request with neither url nor repo (400)', async () => {
    useKey('free');
    useTarget(target());
    const res = await GET(
      new Request('http://localhost/api/v1/verdict', {
        headers: { authorization: 'Bearer ask_live_dummy' },
      }),
    );
    expect(res.status).toBe(400);
  });

  it('enforces the plan-based rate limit (free tier)', async () => {
    useKey('free');
    useTarget(target({ ownership_verified: true }));
    const limit = 60; // RATE_LIMITS.apiKeyFree
    let last = 200;
    for (let i = 0; i < limit; i += 1) {
      last = (await call()).status;
    }
    expect(last).toBe(200);
    const overLimit = await call();
    expect(overLimit.status).toBe(429);
  });
});
