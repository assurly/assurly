import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getAdminDbAdapter: vi.fn(),
}));

vi.mock('../../../../utils/dbAdapter', () => ({
  getAdminDbAdapter: mocks.getAdminDbAdapter,
}));

import { badgeColor, buildBadgeSvg, GET } from './route';

const db = {
  getTargetByBadgeToken: vi.fn(),
  getScanByShareToken: vi.fn(),
  getScanFindings: vi.fn(),
};

describe('GET /api/badge/[token]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAdminDbAdapter.mockReturnValue(db);
    db.getTargetByBadgeToken.mockResolvedValue(null);
  });

  it('uses a public route config', () => {
    expect(GET.security.routeId).toBe('badge:read');
    expect(GET.security.auth).toBe('none');
  });

  it('renders the live target score for a badge_token', async () => {
    const token = 'a'.repeat(32);
    db.getTargetByBadgeToken.mockResolvedValue({
      id: 'target-1',
      badge_token: token,
      current_verdict: 'review',
      current_ship_score: 96,
    });

    const response = await GET(new Request(`http://localhost/api/badge/${token}`), {
      params: Promise.resolve({ token }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('image/svg+xml');
    const svg = await response.text();
    expect(svg).toContain('Verified by Assurly');
    expect(svg).toContain('Ship Score 96/100');
    expect(svg).toContain(`/report/${token}`);
    expect(db.getScanByShareToken).not.toHaveBeenCalled();
  });

  it.each(['blocked', 'ready'] as const)(
    'never fabricates a score for a %s target without a stored ship score',
    async (verdict) => {
      const token = 'c'.repeat(32);
      db.getTargetByBadgeToken.mockResolvedValue({
        id: 'target-1',
        badge_token: token,
        current_verdict: verdict,
        current_ship_score: null,
      });

      const response = await GET(new Request(`http://localhost/api/badge/${token}`), {
        params: Promise.resolve({ token }),
      });

      expect(response.status).toBe(200);
      const svg = await response.text();
      expect(svg).not.toContain('0/100');
      expect(svg).not.toContain('100/100');
      expect(svg).not.toMatch(/Ship Score \d/);
      expect(svg).toContain('Ship Score unavailable');
      expect(db.getScanByShareToken).not.toHaveBeenCalled();
    },
  );

  it('falls back to a scan share token for backward compatibility', async () => {
    db.getScanByShareToken.mockResolvedValue({
      id: 'scan-1',
      share_token: 'a'.repeat(32),
      created_at: '2026-01-01T00:00:00.000Z',
    });
    db.getScanFindings.mockResolvedValue([]);

    const response = await GET(new Request(`http://localhost/api/badge/${'a'.repeat(32)}`), {
      params: Promise.resolve({ token: 'a'.repeat(32) }),
    });

    expect(response.status).toBe(200);
    const svg = await response.text();
    expect(svg).toContain('Verified by Assurly');
    expect(svg).toContain('Ship Score');
  });

  it('returns 404 without a body for an unknown token', async () => {
    db.getScanByShareToken.mockResolvedValue(null);

    const response = await GET(new Request(`http://localhost/api/badge/${'b'.repeat(32)}`), {
      params: Promise.resolve({ token: 'b'.repeat(32) }),
    });

    expect(response.status).toBe(404);
    expect(await response.text()).toBe('');
  });

  it('returns 404 without a body for a malformed token', async () => {
    const response = await GET(new Request('http://localhost/api/badge/not-a-valid-token'), {
      params: Promise.resolve({ token: 'not-a-valid-token' }),
    });

    expect(response.status).toBe(404);
    expect(db.getScanByShareToken).not.toHaveBeenCalled();
    expect(await response.text()).toBe('');
  });
});

describe('buildBadgeSvg', () => {
  it('colors the badge by verdict and links to the trust page', () => {
    expect(buildBadgeSvg(94, 'ready', '/report/abc')).toContain(badgeColor('ready'));
    expect(buildBadgeSvg(94, 'ready', '/report/abc')).toContain('Verified by Assurly');
    expect(buildBadgeSvg(94, 'ready', '/report/abc')).toContain('href="/report/abc"');
    expect(buildBadgeSvg(72, 'review', null)).toContain(badgeColor('review'));
    expect(buildBadgeSvg(40, 'blocked', null)).toContain(badgeColor('blocked'));
  });
});
