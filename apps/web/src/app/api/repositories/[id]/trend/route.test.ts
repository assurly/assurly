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

describe('GET /api/repositories/[id]/trend', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireUser.mockResolvedValue({
      user: { id: 'user-1', name: 'User', email: 'user@example.com', avatar_url: '' },
      accessToken: 'verified',
      db,
    });
    db.getRecentScans.mockResolvedValue([
      {
        id: 'scan-2',
        created_at: '2026-01-02T00:00:00.000Z',
        ship_score: 72,
        scanned_file_count: 12,
      },
      {
        id: 'scan-1',
        created_at: '2026-01-01T00:00:00.000Z',
        ship_score: 96,
        scanned_file_count: 10,
      },
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
    // Scores ≤ incomplete cap skip findings; 96 needs a completeness check.
    expect(db.getScanFindings).toHaveBeenCalledTimes(1);
    expect(db.getScanFindings).toHaveBeenCalledWith('scan-1');
  });

  it('clamps dishonest incomplete scores above the Instant Gate cap', async () => {
    db.getRecentScans.mockResolvedValue([
      {
        id: 'scan-incomplete',
        created_at: '2026-01-04T00:00:00.000Z',
        ship_score: 92,
        scanned_file_count: 250,
      },
    ]);
    db.getScanFindings.mockResolvedValue([
      {
        id: 'f1',
        scan_id: 'scan-incomplete',
        rule_id: 'scan-completeness',
        severity: 'warning',
        confidence: 'high',
        file_path: 'unknown',
        line_number: 1,
        message: 'incomplete',
        suggestion: '',
        created_at: '2026-01-04T00:00:00.000Z',
      },
    ]);

    const response = await GET(
      new Request('http://localhost/api/repositories/00000000-0000-4000-8000-000000000001/trend'),
      { params: Promise.resolve({ id: '00000000-0000-4000-8000-000000000001' }) },
    );

    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      points: Array<{ date: string; shipScore: number }>;
    };
    expect(payload.points[0]?.shipScore).toBe(79);
  });

  it('falls back to recomputation for legacy rows without ship_score', async () => {
    db.getRecentScans.mockResolvedValue([
      { id: 'scan-legacy', created_at: '2026-01-03T00:00:00.000Z', scanned_file_count: 0 },
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
    // Empty eligible-file scans must not invent a high score via 0→1 coercion.
    expect(payload.points[0].shipScore).toBe(0);
    expect(db.getScanFindings).toHaveBeenCalledWith('scan-legacy');
  });
});
