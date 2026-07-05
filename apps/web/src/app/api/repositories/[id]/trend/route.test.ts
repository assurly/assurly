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
      { id: 'scan-2', created_at: '2026-01-02T00:00:00.000Z' },
      { id: 'scan-1', created_at: '2026-01-01T00:00:00.000Z' },
    ]);
    db.getScanFindings
      .mockResolvedValueOnce([
        {
          id: 'finding-2',
          scan_id: 'scan-2',
          rule_id: 'env-leak',
          severity: 'warning',
          file_path: 'app.ts',
          line_number: 3,
          message: 'Warning',
          created_at: '2026-01-02T00:00:00.000Z',
        },
      ])
      .mockResolvedValueOnce([]);
  });

  it('returns a chronological Ship Score series', async () => {
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
    expect(payload.points[0].shipScore).toBe(100);
    expect(payload.points[1].shipScore).toBeLessThan(100);
  });
});
