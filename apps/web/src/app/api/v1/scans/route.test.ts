import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  authenticateApiKey: vi.fn(),
}));

vi.mock('../../../../utils/apiKeys', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../utils/apiKeys')>()),
  authenticateApiKey: mocks.authenticateApiKey,
}));

vi.mock('../../../../utils/dbAdapter', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../utils/dbAdapter')>();
  return {
    ...actual,
    getAdminDbAdapter: () => db,
  };
});

import { POST } from './route';

const db = {
  getRepositories: vi.fn(),
  getRepository: vi.fn(),
  saveScan: vi.fn(),
  getTargetByIdentifier: vi.fn(),
  upsertTarget: vi.fn(),
};

describe('POST /api/v1/scans', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authenticateApiKey.mockResolvedValue({
      id: 'key-1',
      organizationId: 'org-1',
      plan: 'pro',
    });
    db.getRepositories.mockResolvedValue([
      {
        id: '11000000-0000-4000-8000-000000000001',
        organization_id: 'org-1',
        name: 'acme/saas',
        github_repo_id: 1,
        is_active: true,
        created_at: '2026-01-01T00:00:00.000Z',
        scan_capability: 'cli_only',
      },
    ]);
    db.getRepository.mockResolvedValue({
      id: '11000000-0000-4000-8000-000000000001',
      organization_id: 'org-1',
      name: 'acme/saas',
    });
    db.getTargetByIdentifier.mockResolvedValue(null);
    db.saveScan.mockResolvedValue({
      id: '22000000-0000-4000-8000-000000000002',
      repository_id: '11000000-0000-4000-8000-000000000001',
      created_at: '2026-08-10T00:00:00.000Z',
      ship_score: 72,
      verdict: 'review',
    });
  });

  it('persists submitted Ship Gate SoT for a connected repo', async () => {
    const response = await POST(
      new Request('http://localhost/api/v1/scans', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer assurly_test',
        },
        body: JSON.stringify({
          repo: 'acme/saas',
          shipScore: 72,
          verdict: 'review',
          scannedFileCount: 400,
          cleanFileCount: 390,
          findings: [
            {
              ruleId: 'scan-completeness',
              severity: 'warning',
              message: 'Incomplete in browser only',
              file: 'Global Configs',
            },
          ],
        }),
      }),
    );

    expect(response.status).toBe(201);
    const payload = (await response.json()) as { shipScore: number; verdict: string };
    expect(payload.shipScore).toBe(72);
    expect(payload.verdict).toBe('review');
    expect(db.saveScan).toHaveBeenCalledWith(
      '11000000-0000-4000-8000-000000000001',
      'cli',
      'local',
      'success',
      0,
      1,
      expect.any(Array),
      expect.objectContaining({ shipScore: 72, verdict: 'review', scannedFileCount: 400 }),
    );
  });

  it('rejects unknown repositories in the key org', async () => {
    const response = await POST(
      new Request('http://localhost/api/v1/scans', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer assurly_test',
        },
        body: JSON.stringify({
          repo: 'other/app',
          shipScore: 100,
          verdict: 'ready',
          scannedFileCount: 10,
          findings: [],
        }),
      }),
    );
    expect(response.status).toBe(404);
    expect(db.saveScan).not.toHaveBeenCalled();
  });
});
