import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ requireUser: vi.fn() }));
vi.mock('../../../utils/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../utils/auth')>()),
  requireUser: mocks.requireUser,
}));

import { GET, POST } from './route';
import type { TargetCard } from './route';
import { resolveDisplayedShipScore } from '../../../utils/shipScoreDisplay';

const db = {
  getOrganizationByUserId: vi.fn(),
  getRepositories: vi.fn(),
  getTargets: vi.fn(),
  getRecentScans: vi.fn(),
  getLatestScanSummaries: vi.fn(),
  getScanFindings: vi.fn(),
  getTargetByIdentifier: vi.fn(),
  upsertTarget: vi.fn(),
};

function rlsFinding(scanId: string) {
  return {
    id: `f-${scanId}`,
    scan_id: scanId,
    rule_id: 'supabase-rls',
    severity: 'error' as const,
    file_path: 'schema.sql',
    line_number: 1,
    message: "Supabase table 'users' is created but Row-Level Security (RLS) is not enabled.",
    created_at: '2026-07-13T00:00:00.000Z',
  };
}

async function callGet(): Promise<{ targets: TargetCard[] }> {
  const res = await GET(new Request('http://localhost/api/targets'));
  expect(res.status).toBe(200);
  return res.json();
}

describe('GET /api/targets', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireUser.mockResolvedValue({
      user: { id: 'user-1', name: 'User', email: 'user@example.com', avatar_url: '' },
      accessToken: 'verified',
      db,
    });
    db.getOrganizationByUserId.mockResolvedValue({
      id: 'org-1',
      name: 'acme',
      billing_plan: 'pro',
    });
    db.getLatestScanSummaries.mockResolvedValue(new Map());
  });

  it('returns an empty list when the user has no organization', async () => {
    db.getOrganizationByUserId.mockResolvedValue(null);
    const { targets } = await callGet();
    expect(targets).toEqual([]);
  });

  it('card and detail projections agree when a legacy scan has no stored ship_score', async () => {
    const tables = ['attempts', 'config', 'requests', 'sessions', 'users'];
    const findings = [
      ...tables.map((table, index) => ({
        id: `rls-${table}`,
        scan_id: 'scan-phpauth',
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
        scan_id: 'scan-phpauth',
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
    db.getRepositories.mockResolvedValue([
      {
        id: 'a26e03a7-42b0-42be-b2c9-fd685ea177a0',
        organization_id: 'org-1',
        name: 'tibco87/PHPAuth',
      },
    ]);
    db.getTargets.mockResolvedValue([
      {
        id: 'target-phpauth',
        organization_id: 'org-1',
        repository_id: 'a26e03a7-42b0-42be-b2c9-fd685ea177a0',
        kind: 'repo',
        identifier: 'tibco87/PHPAuth',
        display_name: 'tibco87/PHPAuth',
        generator_fingerprint: null,
        ownership_verified: false,
        current_verdict: 'blocked',
        current_ship_score: 36,
        verdict_evidence: {},
        last_checked_at: '2026-08-09T19:47:28.312Z',
        badge_token: null,
      },
    ]);
    db.getLatestScanSummaries.mockResolvedValue(
      new Map([
        [
          'a26e03a7-42b0-42be-b2c9-fd685ea177a0',
          {
            id: 'scan-phpauth',
            repository_id: 'a26e03a7-42b0-42be-b2c9-fd685ea177a0',
            ship_score: null,
            created_at: '2026-08-09T19:47:28.312Z',
          },
        ],
      ]),
    );
    db.getRecentScans.mockResolvedValue([
      {
        id: 'scan-phpauth',
        ship_score: null,
        scanned_file_count: null,
        clean_file_count: null,
        created_at: '2026-08-09T19:47:28.312Z',
      },
    ]);
    db.getScanFindings.mockResolvedValue(findings);

    const { targets } = await callGet();
    const detailScore = resolveDisplayedShipScore(
      { ship_score: null, scanned_file_count: null, clean_file_count: null },
      findings,
    );
    expect(targets[0].shipScore).toBe(detailScore);
    expect(targets[0].shipScore).toBe(59);
    expect(targets[0].shipScore).not.toBe(36);
  });

  it('uses the synced target row as the authoritative verdict', async () => {
    db.getRepositories.mockResolvedValue([
      { id: 'repo-1', organization_id: 'org-1', name: 'acme/api' },
    ]);
    db.getTargets.mockResolvedValue([
      {
        id: 'target-1',
        organization_id: 'org-1',
        repository_id: 'repo-1',
        kind: 'repo',
        identifier: 'acme/api',
        display_name: 'acme/api',
        generator_fingerprint: 'lovable',
        ownership_verified: false,
        current_verdict: 'blocked',
        current_ship_score: 76,
        verdict_evidence: { topIssue: { label: 'Row-Level Security', severity: 'error' } },
        last_checked_at: '2026-07-13T10:00:00.000Z',
        badge_token: null,
      },
    ]);
    db.getLatestScanSummaries.mockResolvedValue(
      new Map([
        [
          'repo-1',
          {
            id: 'scan-9',
            repository_id: 'repo-1',
            ship_score: 76,
            created_at: '2026-07-13T10:00:00.000Z',
            verdict: 'blocked',
          },
        ],
      ]),
    );

    const { targets } = await callGet();
    expect(targets).toHaveLength(1);
    expect(targets[0]).toMatchObject({
      id: 'target-1',
      verdict: 'blocked',
      shipScore: 59,
      generatorFingerprint: 'lovable',
      latestScanId: 'scan-9',
      guardianEnabled: true,
      scoreDropped: false,
    });
    expect(db.getScanFindings).not.toHaveBeenCalled();
    expect(db.getRecentScans).not.toHaveBeenCalled();
    expect(db.getLatestScanSummaries).toHaveBeenCalledTimes(1);
  });

  it('clamps incomplete target projections and prefers latest scan ship_score', async () => {
    db.getRepositories.mockResolvedValue([
      { id: 'repo-2', organization_id: 'org-1', name: 'vercel/eve' },
    ]);
    db.getTargets.mockResolvedValue([
      {
        id: 'target-2',
        organization_id: 'org-1',
        repository_id: 'repo-2',
        kind: 'repo',
        identifier: 'vercel/eve',
        display_name: 'vercel/eve',
        generator_fingerprint: null,
        ownership_verified: false,
        current_verdict: 'review',
        current_ship_score: 92,
        verdict_evidence: {
          topIssue: {
            key: 'rule:scan-completeness',
            label: 'Scan is incomplete',
            severity: 'warning',
          },
        },
        last_checked_at: '2026-07-31T10:00:00.000Z',
        badge_token: null,
      },
    ]);
    db.getLatestScanSummaries.mockResolvedValue(
      new Map([
        [
          'repo-2',
          {
            id: 'scan-eve',
            repository_id: 'repo-2',
            ship_score: 79,
            created_at: '2026-07-31T10:00:00.000Z',
          },
        ],
      ]),
    );

    const { targets } = await callGet();
    expect(targets[0]).toMatchObject({
      id: 'target-2',
      verdict: 'review',
      shipScore: 79,
      latestScanId: 'scan-eve',
    });
  });

  it('lists guarded URL targets including pending ownership verification', async () => {
    db.getRepositories.mockResolvedValue([]);
    db.getTargets.mockResolvedValue([
      {
        id: 'pending-1',
        organization_id: 'org-1',
        repository_id: null,
        kind: 'url',
        identifier: 'https://fastshare.cz',
        display_name: 'https://fastshare.cz',
        generator_fingerprint: null,
        ownership_verified: false,
        current_verdict: 'blocked',
        current_ship_score: 84,
        verdict_evidence: null,
        last_checked_at: '2026-07-30T20:00:00.000Z',
        badge_token: null,
      },
      {
        id: 'guarded-1',
        organization_id: 'org-1',
        repository_id: null,
        kind: 'url',
        identifier: 'https://myapp.lovable.app',
        display_name: 'https://myapp.lovable.app',
        generator_fingerprint: 'lovable',
        ownership_verified: true,
        current_verdict: 'ready',
        current_ship_score: 100,
        verdict_evidence: {},
        last_checked_at: '2026-07-30T10:00:00.000Z',
        badge_token: null,
      },
    ]);

    const { targets } = await callGet();
    expect(targets).toHaveLength(2);
    const fastshare = targets.find((target) => target.id === 'pending-1');
    expect(fastshare?.verdict).toBe('blocked');
    expect(fastshare?.shipScore).toBeLessThanOrEqual(59);
    expect(targets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'pending-1',
          kind: 'url',
          ownershipVerified: false,
          guardianEnabled: false,
        }),
        expect.objectContaining({
          id: 'guarded-1',
          kind: 'url',
          ownershipVerified: true,
          guardianEnabled: true,
        }),
      ]),
    );
  });

  it('derives the verdict from the latest scan when no target row exists yet', async () => {
    db.getRepositories.mockResolvedValue([
      { id: 'repo-2', organization_id: 'org-1', name: 'acme/legacy' },
    ]);
    db.getTargets.mockResolvedValue([]);
    db.getRecentScans.mockResolvedValue([{ id: 'scan-5', created_at: '2026-07-12T00:00:00.000Z' }]);
    db.getScanFindings.mockResolvedValue([rlsFinding('scan-5')]);

    const { targets } = await callGet();
    expect(targets).toHaveLength(1);
    expect(targets[0]).toMatchObject({
      id: 'repo:repo-2',
      verdict: 'blocked',
      latestScanId: 'scan-5',
      lastCheckedAt: '2026-07-12T00:00:00.000Z',
    });
    expect(targets[0].shipScore).toBeLessThan(100);
  });

  /**
   * The branch rule is only as good as the default branch the route hands it.
   * If this map stops being passed the rule silently reverts to guessing
   * main/master, and a repo that ships from elsewhere shows a feature branch's
   * score again — with no test failing anywhere else.
   */
  it('hands each repository its own default branch to the scan lookup', async () => {
    db.getRepositories.mockResolvedValue([
      { id: 'repo-a', organization_id: 'org-1', name: 'tibco87/Anima', default_branch: 'src' },
      { id: 'repo-b', organization_id: 'org-1', name: 'acme/plain' },
    ]);
    db.getTargets.mockResolvedValue([]);
    db.getRecentScans.mockResolvedValue([]);

    await callGet();

    expect(db.getLatestScanSummaries).toHaveBeenCalledWith(
      ['repo-a', 'repo-b'],
      new Map([
        ['repo-a', 'src'],
        ['repo-b', undefined],
      ]),
    );
  });

  it('leaves a repository unscanned when its only scan is off the default branch', async () => {
    db.getRepositories.mockResolvedValue([
      { id: 'repo-a', organization_id: 'org-1', name: 'tibco87/Anima', default_branch: 'src' },
    ]);
    db.getTargets.mockResolvedValue([]);
    // The dashboard used to read this `main` scan as the repository verdict.
    db.getRecentScans.mockResolvedValue([
      {
        id: 'scan-main',
        branch: 'main',
        ship_score: 59,
        verdict: 'blocked',
        created_at: '2026-08-29T00:00:00.000Z',
      },
    ]);

    const { targets } = await callGet();
    expect(targets[0]).toMatchObject({ verdict: 'unknown', shipScore: null, latestScanId: null });
  });

  it('reports "unknown" for a repository that has never been scanned', async () => {
    db.getRepositories.mockResolvedValue([
      { id: 'repo-3', organization_id: 'org-1', name: 'acme/fresh' },
    ]);
    db.getTargets.mockResolvedValue([]);
    db.getRecentScans.mockResolvedValue([]);

    const { targets } = await callGet();
    expect(targets[0]).toMatchObject({
      verdict: 'unknown',
      shipScore: null,
      lastCheckedAt: null,
      latestScanId: null,
    });
  });

  it('does not show a 0 score for a synced target whose latest scan failed empty', async () => {
    db.getRepositories.mockResolvedValue([
      { id: 'repo-empty', organization_id: 'org-1', name: 'tibco87/SentinelLog' },
    ]);
    db.getTargets.mockResolvedValue([
      {
        id: 'target-empty',
        organization_id: 'org-1',
        repository_id: 'repo-empty',
        kind: 'repo',
        identifier: 'tibco87/SentinelLog',
        display_name: 'tibco87/SentinelLog',
        generator_fingerprint: null,
        ownership_verified: false,
        current_verdict: 'unknown',
        current_ship_score: null,
        verdict_evidence: {},
        last_checked_at: '2026-08-21T20:00:00.000Z',
        badge_token: null,
      },
    ]);
    db.getLatestScanSummaries.mockResolvedValue(
      new Map([
        [
          'repo-empty',
          {
            id: 'scan-empty',
            repository_id: 'repo-empty',
            ship_score: 0,
            created_at: '2026-08-21T20:00:00.000Z',
            verdict: 'failed',
            failure_reason: 'no_eligible_files',
          },
        ],
      ]),
    );

    const { targets } = await callGet();
    expect(targets[0]).toMatchObject({
      verdict: 'unknown',
      shipScore: null,
      lastScanFailed: true,
      lastScanFailureReason: 'no_eligible_files',
      lastCheckedAt: '2026-08-21T20:00:00.000Z',
      latestScanId: 'scan-empty',
    });
  });

  it('sorts the most urgent apps first (blocked → review → ready → unknown)', async () => {
    db.getRepositories.mockResolvedValue([
      { id: 'repo-ready', organization_id: 'org-1', name: 'a/ready' },
      { id: 'repo-blocked', organization_id: 'org-1', name: 'a/blocked' },
      { id: 'repo-fresh', organization_id: 'org-1', name: 'a/fresh' },
    ]);
    db.getTargets.mockResolvedValue([]);
    db.getRecentScans.mockImplementation((repoId: string) => {
      if (repoId === 'repo-fresh') return Promise.resolve([]);
      return Promise.resolve([{ id: `scan-${repoId}`, created_at: '2026-07-12T00:00:00.000Z' }]);
    });
    db.getScanFindings.mockImplementation((scanId: string) =>
      scanId === 'scan-repo-blocked' ? Promise.resolve([rlsFinding(scanId)]) : Promise.resolve([]),
    );

    const { targets } = await callGet();
    expect(targets.map((t) => t.verdict)).toEqual(['blocked', 'ready', 'unknown']);
  });

  it('loads latest scans in one batch instead of per repository', async () => {
    db.getRepositories.mockResolvedValue([
      { id: 'repo-a', organization_id: 'org-1', name: 'acme/a' },
      { id: 'repo-b', organization_id: 'org-1', name: 'acme/b' },
      { id: 'repo-c', organization_id: 'org-1', name: 'acme/c' },
    ]);
    db.getTargets.mockResolvedValue(
      ['repo-a', 'repo-b', 'repo-c'].map((id) => ({
        id: `target-${id}`,
        organization_id: 'org-1',
        repository_id: id,
        kind: 'repo',
        identifier: `acme/${id}`,
        display_name: `acme/${id}`,
        generator_fingerprint: null,
        ownership_verified: false,
        current_verdict: 'review',
        current_ship_score: 70,
        verdict_evidence: {},
        last_checked_at: '2026-07-13T10:00:00.000Z',
        badge_token: null,
      })),
    );
    db.getLatestScanSummaries.mockResolvedValue(
      new Map(
        ['repo-a', 'repo-b', 'repo-c'].map((id) => [
          id,
          {
            id: `scan-${id}`,
            repository_id: id,
            ship_score: 70,
            created_at: '2026-07-13T10:00:00.000Z',
          },
        ]),
      ),
    );

    const { targets } = await callGet();
    expect(targets).toHaveLength(3);
    expect(db.getLatestScanSummaries).toHaveBeenCalledTimes(1);
    expect(db.getRecentScans).not.toHaveBeenCalled();
  });
});

describe('POST /api/targets', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireUser.mockResolvedValue({
      user: { id: 'user-1', name: 'User', email: 'user@example.com', avatar_url: '' },
      accessToken: 'verified',
      db,
    });
    db.getOrganizationByUserId.mockResolvedValue({
      id: 'org-1',
      name: 'acme',
      billing_plan: 'free',
    });
    db.getRepositories.mockResolvedValue([]);
    db.getTargets.mockResolvedValue([]);
    db.getTargetByIdentifier.mockResolvedValue(null);
    db.upsertTarget.mockResolvedValue({
      id: 'new-target',
      kind: 'url',
      identifier: 'https://myapp.lovable.app',
      ownership_verified: false,
    });
  });

  it('creates a URL target for an explicit Guard action', async () => {
    const res = await POST(
      new Request('http://localhost/api/targets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: 'https://myapp.lovable.app' }),
      }),
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.target).toEqual({
      id: 'new-target',
      kind: 'url',
      identifier: 'https://myapp.lovable.app',
      ownershipVerified: false,
    });
    expect(db.upsertTarget).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: 'org-1',
        kind: 'url',
        identifier: 'https://myapp.lovable.app',
      }),
    );
  });

  it('rejects a new guarded app past the free plan limit', async () => {
    db.getRepositories.mockResolvedValue([{ id: 'repo-1', name: 'acme/one' }]);
    db.getTargets.mockResolvedValue([]);

    const res = await POST(
      new Request('http://localhost/api/targets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: 'https://second.lovable.app' }),
      }),
    );
    expect(res.status).toBe(402);
    expect((await res.json()).error.code).toBe('plan_required');
    expect(db.upsertTarget).not.toHaveBeenCalled();
  });

  it('fails closed when the guarded-app count cannot be loaded', async () => {
    db.getTargets.mockRejectedValue(new Error('db unavailable'));

    const res = await POST(
      new Request('http://localhost/api/targets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: 'https://second.lovable.app' }),
      }),
    );
    expect(res.status).toBe(503);
    expect((await res.json()).error.code).toBe('plan_limit_unavailable');
    expect(db.upsertTarget).not.toHaveBeenCalled();
  });
});
