import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getAdminDbAdapter: vi.fn(),
}));

vi.mock('../../../../utils/dbAdapter', () => ({
  getAdminDbAdapter: mocks.getAdminDbAdapter,
}));

import { badgeColor, buildBadgeSvg, GET } from './route';

const db = {
  getScanByShareToken: vi.fn(),
  getScanFindings: vi.fn(),
};

describe('GET /api/badge/[token]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAdminDbAdapter.mockReturnValue(db);
  });

  it('uses a public route config', () => {
    expect(GET.security.routeId).toBe('badge:read');
    expect(GET.security.auth).toBe('none');
  });

  it('returns SVG with the expected content type for a valid token', async () => {
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
    expect(response.headers.get('content-type')).toContain('image/svg+xml');
    expect(response.headers.get('cache-control')).toContain('public');
    const svg = await response.text();
    expect(svg).toContain('Ship Score');
    expect(svg).toContain('/100');
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
  it('colors the badge by verdict', () => {
    expect(buildBadgeSvg(94, 'ready')).toContain(badgeColor('ready'));
    expect(buildBadgeSvg(72, 'review')).toContain(badgeColor('review'));
    expect(buildBadgeSvg(40, 'blocked')).toContain(badgeColor('blocked'));
  });
});
