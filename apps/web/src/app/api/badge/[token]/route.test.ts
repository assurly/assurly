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
  getRepository: vi.fn(),
  getRecentScans: vi.fn(),
};

const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (days: number): string => new Date(Date.now() - days * DAY).toISOString();
const HEAD = 'a'.repeat(40);
const OLDER = 'b'.repeat(40);

async function badgeFor(token: string): Promise<string> {
  const response = await GET(new Request(`http://localhost/api/badge/${token}`), {
    params: Promise.resolve({ token }),
  });
  expect(response.status).toBe(200);
  return response.text();
}

describe('GET /api/badge/[token]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAdminDbAdapter.mockReturnValue(db);
    db.getTargetByBadgeToken.mockResolvedValue(null);
    db.getRepository.mockResolvedValue(null);
    db.getRecentScans.mockResolvedValue([]);
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
      repository_id: 'repo-1',
      commit_sha: HEAD,
      share_token: 'a'.repeat(32),
      created_at: daysAgo(1),
    });
    db.getScanFindings.mockResolvedValue([]);
    db.getRepository.mockResolvedValue({ id: 'repo-1', head_commit_sha: HEAD });

    const svg = await badgeFor('a'.repeat(32));
    expect(svg).toContain('Verified by Assurly');
    expect(svg).toContain('Ship Score');
  });

  it('turns a shared scan badge grey with its age once the scan is old', async () => {
    db.getScanByShareToken.mockResolvedValue({
      id: 'scan-1',
      repository_id: 'repo-1',
      commit_sha: HEAD,
      share_token: 'a'.repeat(32),
      created_at: daysAgo(128),
    });
    db.getScanFindings.mockResolvedValue([]);

    const svg = await badgeFor('a'.repeat(32));
    expect(svg).not.toContain('Verified by');
    expect(svg).toContain('Ship Score 100/100 · 128 days old');
    expect(svg).toContain(badgeColor('unknown'));
    expect(svg).not.toContain(badgeColor('ready'));
  });

  it('says the code changed since a repository verdict, however recent', async () => {
    const token = 'd'.repeat(32);
    db.getTargetByBadgeToken.mockResolvedValue({
      id: 'target-1',
      kind: 'repo',
      repository_id: 'repo-1',
      badge_token: token,
      current_verdict: 'ready',
      current_ship_score: 100,
      last_checked_at: daysAgo(0.1),
    });
    db.getRepository.mockResolvedValue({
      id: 'repo-1',
      default_branch: 'main',
      head_commit_sha: HEAD,
    });
    db.getRecentScans.mockResolvedValue([
      { id: 'scan-1', branch: 'main', commit_sha: OLDER, created_at: daysAgo(0.1) },
    ]);

    const svg = await badgeFor(token);
    expect(svg).toContain('Ship Score 100/100 · code changed since');
    expect(svg).not.toContain('Verified by');
    expect(svg).toContain(badgeColor('unknown'));
  });

  it('stays verified for a repository checked at its newest commit', async () => {
    const token = 'e'.repeat(32);
    db.getTargetByBadgeToken.mockResolvedValue({
      id: 'target-1',
      kind: 'repo',
      repository_id: 'repo-1',
      badge_token: token,
      current_verdict: 'ready',
      current_ship_score: 100,
      last_checked_at: daysAgo(0.1),
    });
    db.getRepository.mockResolvedValue({
      id: 'repo-1',
      default_branch: 'main',
      head_commit_sha: HEAD,
    });
    db.getRecentScans.mockResolvedValue([
      { id: 'scan-1', branch: 'main', commit_sha: HEAD, created_at: daysAgo(0.1) },
    ]);

    const svg = await badgeFor(token);
    expect(svg).toContain('Verified by Assurly · Ship Score 100/100');
    expect(svg).toContain(badgeColor('ready'));
  });

  it('still renders, by age, when the repository lookup fails', async () => {
    const token = 'f'.repeat(32);
    db.getTargetByBadgeToken.mockResolvedValue({
      id: 'target-1',
      kind: 'repo',
      repository_id: 'repo-1',
      badge_token: token,
      current_verdict: 'ready',
      current_ship_score: 100,
      last_checked_at: daysAgo(30),
    });
    db.getRepository.mockRejectedValue(new Error('db down'));

    expect(await badgeFor(token)).toContain('Ship Score 100/100 · 30 days old');
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
  it('widens to fit a longer out-of-date label', () => {
    const svg = buildBadgeSvg(100, 'ready', null, { status: 'code_changed', daysOld: 0 });
    const width = Number(svg.match(/<svg[^>]*width="(\d+)"/)?.[1]);
    expect(width).toBeGreaterThan(260);
    expect(svg).toContain(`x="${width / 2}"`);
  });

  it('colors the badge by verdict and links to the trust page', () => {
    expect(buildBadgeSvg(94, 'ready', '/report/abc')).toContain(badgeColor('ready'));
    expect(buildBadgeSvg(94, 'ready', '/report/abc')).toContain('Verified by Assurly');
    expect(buildBadgeSvg(94, 'ready', '/report/abc')).toContain('href="/report/abc"');
    expect(buildBadgeSvg(72, 'review', null)).toContain(badgeColor('review'));
    expect(buildBadgeSvg(40, 'blocked', null)).toContain(badgeColor('blocked'));
  });
});
