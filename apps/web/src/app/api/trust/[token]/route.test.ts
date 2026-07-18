import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getAdminDbAdapter: vi.fn(),
}));

vi.mock('../../../../utils/dbAdapter', () => ({
  getAdminDbAdapter: mocks.getAdminDbAdapter,
}));

import { GET } from './route';
import { PUBLIC_TRUST_KEYS } from '../../../../utils/publicTrust';

const db = {
  getTargetByBadgeToken: vi.fn(),
};

describe('GET /api/trust/[token]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAdminDbAdapter.mockReturnValue(db);
  });

  it('returns a whitelisted public projection with no evidence/PII fields', async () => {
    db.getTargetByBadgeToken.mockResolvedValue({
      id: 'target-1',
      organization_id: 'org-1',
      kind: 'url',
      identifier: 'https://app.example',
      display_name: 'App',
      generator_fingerprint: 'lovable',
      ownership_verified: true,
      current_verdict: 'ready',
      current_ship_score: 100,
      verdict_evidence: {
        topIssue: null,
        blockerSnapshot: [{ rule_id: 'x', file_path: 'runtime', message: 'raw' }],
      },
      last_checked_at: '2026-07-18T08:00:00.000Z',
      badge_token: 'c'.repeat(32),
    });

    const token = 'c'.repeat(32);
    const response = await GET(new Request(`http://localhost/api/trust/${token}`), {
      params: Promise.resolve({ token }),
    });

    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual([...PUBLIC_TRUST_KEYS].sort());
    expect(JSON.stringify(body)).not.toContain('blockerSnapshot');
    expect(JSON.stringify(body)).not.toContain('organization_id');
    expect(JSON.stringify(body)).not.toContain('raw');
  });

  it('returns 404 for an unknown token', async () => {
    db.getTargetByBadgeToken.mockResolvedValue(null);
    const token = 'd'.repeat(32);
    const response = await GET(new Request(`http://localhost/api/trust/${token}`), {
      params: Promise.resolve({ token }),
    });
    expect(response.status).toBe(404);
  });
});
