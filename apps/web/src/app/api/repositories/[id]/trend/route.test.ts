import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ requireUser: vi.fn() }));
vi.mock('../../../../../utils/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../../utils/auth')>()),
  requireUser: mocks.requireUser,
}));

vi.mock('../../../../../utils/authorization', () => ({
  requireRepositoryAccess: vi.fn().mockResolvedValue(undefined),
}));

import { GET } from './route';

const db = {
  getRecentScans: vi.fn(),
  getScanFindings: vi.fn(),
};

const sharedSha = 'c8039c4aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const otherSha = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

function scanRow(
  overrides: Record<string, unknown> & { id: string; created_at: string },
): Record<string, unknown> {
  return {
    repository_id: '00000000-0000-4000-8000-000000000001',
    commit_sha: otherSha,
    branch: 'main',
    status: 'success',
    ship_score: 72,
    scanned_file_count: 12,
    ...overrides,
  };
}

describe('GET /api/repositories/[id]/trend', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireUser.mockResolvedValue({
      user: { id: 'user-1', name: 'User', email: 'user@example.com', avatar_url: '' },
      accessToken: 'verified',
      db,
    });
    db.getRecentScans.mockResolvedValue([
      scanRow({
        id: 'scan-2',
        created_at: '2026-01-02T00:00:00.000Z',
        ship_score: 72,
        scanned_file_count: 12,
        commit_sha: otherSha,
      }),
      scanRow({
        id: 'scan-1',
        created_at: '2026-01-01T00:00:00.000Z',
        ship_score: 96,
        scanned_file_count: 10,
        commit_sha: sharedSha,
      }),
    ]);
    db.getScanFindings.mockResolvedValue([]);
  });

  it('returns a chronological Ship Score series from persisted scores', async () => {
    const response = await GET(
      new Request('http://localhost/api/repositories/00000000-0000-4000-8000-000000000001/trend'),
      { params: Promise.resolve({ id: '00000000-0000-4000-8000-000000000001' }) },
    );

    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      points: Array<{ date: string; shipScore: number }>;
    };
    expect(payload.points).toHaveLength(2);
    expect(payload.points[0].date).toBe('2026-01-01T00:00:00.000Z');
    expect(payload.points[1].date).toBe('2026-01-02T00:00:00.000Z');
    expect(payload.points[0].shipScore).toBe(96);
    expect(payload.points[1].shipScore).toBe(72);
    expect(db.getScanFindings).not.toHaveBeenCalled();
  });

  it('collapses duplicate commit SHAs and skips findings when scores are persisted', async () => {
    db.getRecentScans.mockResolvedValue([
      scanRow({
        id: 'other',
        created_at: '2026-01-02T00:00:00.000Z',
        ship_score: 80,
        commit_sha: otherSha,
      }),
      ...Array.from({ length: 8 }, (_, index) =>
        scanRow({
          id: `dup-${7 - index}`,
          created_at: `2026-01-01T0${7 - index}:00:00.000Z`,
          ship_score: 59,
          commit_sha: sharedSha,
        }),
      ),
    ]);

    const response = await GET(
      new Request('http://localhost/api/repositories/00000000-0000-4000-8000-000000000001/trend'),
      { params: Promise.resolve({ id: '00000000-0000-4000-8000-000000000001' }) },
    );

    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      points: Array<{ date: string; shipScore: number }>;
    };
    expect(payload.points).toHaveLength(2);
    expect(payload.points[0].shipScore).toBe(59);
    expect(payload.points[1].shipScore).toBe(80);
    expect(db.getScanFindings).not.toHaveBeenCalled();
  });

  it('clamps a blocked persisted score without fetching findings', async () => {
    db.getRecentScans.mockResolvedValue([
      scanRow({
        id: 'scan-blocked',
        created_at: '2026-01-04T00:00:00.000Z',
        ship_score: 84,
        verdict: 'blocked',
        commit_sha: sharedSha,
      }),
    ]);

    const response = await GET(
      new Request('http://localhost/api/repositories/00000000-0000-4000-8000-000000000001/trend'),
      { params: Promise.resolve({ id: '00000000-0000-4000-8000-000000000001' }) },
    );

    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      points: Array<{ date: string; shipScore: number }>;
    };
    expect(payload.points[0]?.shipScore).toBe(59);
    expect(db.getScanFindings).not.toHaveBeenCalled();
  });

  it('falls back to recomputation for legacy rows without ship_score', async () => {
    db.getRecentScans.mockResolvedValue([
      scanRow({
        id: 'scan-legacy',
        created_at: '2026-01-03T00:00:00.000Z',
        scanned_file_count: 0,
        ship_score: null,
        commit_sha: sharedSha,
      }),
    ]);
    db.getScanFindings.mockResolvedValue([]);

    const response = await GET(
      new Request('http://localhost/api/repositories/00000000-0000-4000-8000-000000000001/trend'),
      { params: Promise.resolve({ id: '00000000-0000-4000-8000-000000000001' }) },
    );

    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      points: Array<{ date: string; shipScore: number }>;
    };
    expect(payload.points).toHaveLength(1);
    expect(payload.points[0].shipScore).toBe(0);
    expect(db.getScanFindings).toHaveBeenCalledWith('scan-legacy');
  });

  it('omits a legacy point when findings fetch throws instead of failing the series', async () => {
    db.getRecentScans.mockResolvedValue([
      scanRow({
        id: 'scan-ok',
        created_at: '2026-01-02T00:00:00.000Z',
        ship_score: 80,
        commit_sha: otherSha,
      }),
      scanRow({
        id: 'scan-legacy',
        created_at: '2026-01-01T00:00:00.000Z',
        ship_score: null,
        commit_sha: sharedSha,
      }),
    ]);
    db.getScanFindings.mockRejectedValue(new Error('timeout'));

    const response = await GET(
      new Request('http://localhost/api/repositories/00000000-0000-4000-8000-000000000001/trend'),
      { params: Promise.resolve({ id: '00000000-0000-4000-8000-000000000001' }) },
    );

    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      points: Array<{ date: string; shipScore: number }>;
    };
    expect(payload.points).toEqual([{ date: '2026-01-02T00:00:00.000Z', shipScore: 80 }]);
  });
});
