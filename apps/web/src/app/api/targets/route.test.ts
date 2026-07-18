import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ requireUser: vi.fn() }));
vi.mock('../../../utils/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../utils/auth')>()),
  requireUser: mocks.requireUser,
}));

import { GET } from './route';
import type { TargetCard } from './route';

const db = {
  getOrganizationByUserId: vi.fn(),
  getRepositories: vi.fn(),
  getTargets: vi.fn(),
  getRecentScans: vi.fn(),
  getScanFindings: vi.fn(),
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
    db.getOrganizationByUserId.mockResolvedValue({ id: 'org-1', name: 'acme' });
  });

  it('returns an empty list when the user has no organization', async () => {
    db.getOrganizationByUserId.mockResolvedValue(null);
    const { targets } = await callGet();
    expect(targets).toEqual([]);
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
    db.getRecentScans.mockResolvedValue([{ id: 'scan-9', created_at: '2026-07-13T10:00:00.000Z' }]);

    const { targets } = await callGet();
    expect(targets).toHaveLength(1);
    expect(targets[0]).toMatchObject({
      id: 'target-1',
      verdict: 'blocked',
      shipScore: 76,
      generatorFingerprint: 'lovable',
      latestScanId: 'scan-9',
      guardianEnabled: true,
      scoreDropped: false,
    });
    // A synced target must not pay for a findings re-derivation.
    expect(db.getScanFindings).not.toHaveBeenCalled();
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
});
