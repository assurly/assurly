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

  it('persists the server-computed Ship Gate for a connected repo, not a claim the findings contradict', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    // One scan-completeness warning persisted, nothing truncated: the incomplete
    // coverage cap makes 79/review what the findings prove; 72 is a drift and is
    // logged, not stored.
    db.saveScan.mockResolvedValue({
      id: '22000000-0000-4000-8000-000000000002',
      repository_id: '11000000-0000-4000-8000-000000000001',
      created_at: '2026-08-10T00:00:00.000Z',
      ship_score: 79,
      verdict: 'review',
    });
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
    // The response echoes what was stored — never the claim.
    expect(payload.shipScore).toBe(79);
    expect(payload.verdict).toBe('review');
    expect(db.saveScan).toHaveBeenCalledWith(
      '11000000-0000-4000-8000-000000000001',
      'cli',
      'local',
      'success',
      0,
      1,
      expect.any(Array),
      expect.objectContaining({ shipScore: 79, verdict: 'review', scannedFileCount: 400 }),
    );
    expect(warn).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(warn.mock.calls[0]?.[0]))).toMatchObject({
      event: 'ship-gate-claim-rejected',
      route: 'v1:scans:create',
      reason: 'differs-without-truncation',
    });
    warn.mockRestore();
  });

  it('keeps a worse CLI gate when the submitted slice is truncated at the limit', async () => {
    db.saveScan.mockResolvedValue({
      id: '22000000-0000-4000-8000-000000000002',
      repository_id: '11000000-0000-4000-8000-000000000001',
      created_at: '2026-08-10T00:00:00.000Z',
      ship_score: 12,
      verdict: 'review',
    });
    const response = await POST(
      new Request('http://localhost/api/v1/scans', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer assurly_test' },
        body: JSON.stringify({
          repo: 'acme/saas',
          shipScore: 12,
          verdict: 'review',
          scannedFileCount: 900,
          findings: Array.from({ length: 100 }, (_, i) => ({
            ruleId: 'undocumented-env',
            severity: 'warning',
            message: `Env ${i}`,
            file: `src/${i}.ts`,
          })),
        }),
      }),
    );
    expect(response.status).toBe(201);
    expect(db.saveScan).toHaveBeenCalledWith(
      expect.any(String),
      'cli',
      'local',
      'success',
      0,
      100,
      expect.any(Array),
      expect.objectContaining({ shipScore: 12, verdict: 'review' }),
    );
  });

  it('stores a failed CLI scan with no score, like the browser route', async () => {
    db.saveScan.mockResolvedValue({
      id: '22000000-0000-4000-8000-000000000002',
      repository_id: '11000000-0000-4000-8000-000000000001',
      created_at: '2026-08-10T00:00:00.000Z',
      ship_score: null,
      verdict: 'failed',
    });
    const response = await POST(
      new Request('http://localhost/api/v1/scans', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer assurly_test' },
        body: JSON.stringify({
          repo: 'acme/saas',
          shipScore: 0,
          verdict: 'failed',
          scannedFileCount: 0,
          findings: [],
        }),
      }),
    );
    expect(response.status).toBe(201);
    expect(db.saveScan).toHaveBeenCalledWith(
      expect.any(String),
      'cli',
      'local',
      'failed',
      0,
      0,
      [],
      expect.objectContaining({ shipScore: null, verdict: 'failed' }),
    );
    expect(((await response.json()) as { shipScore: number | null }).shipScore).toBeNull();
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
