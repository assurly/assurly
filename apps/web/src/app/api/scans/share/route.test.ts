import { describe, expect, it, vi } from 'vitest';
import { POST } from './route';

vi.mock('../../../../utils/apiSecurity', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../utils/apiSecurity')>();
  return {
    ...actual,
    requireRouteUser: vi.fn(() => ({
      user: { id: 'user-1' },
      db: {
        getOrganizationByUserId: vi.fn().mockResolvedValue({ billing_plan: 'pro' }),
        getScan: vi.fn().mockResolvedValue({ id: 'scan-1', share_token: null }),
        setScanShareToken: vi.fn().mockResolvedValue({ id: 'scan-1', share_token: 'abc' }),
      },
    })),
  };
});

vi.mock('../../../../utils/authorization', () => ({
  requireScanAccess: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../../../utils/env', () => ({
  getApplicationUrl: () => 'https://shipready.dev',
}));

describe('POST /api/scans/share', () => {
  it('requires pro plan messaging in route config', () => {
    expect(POST.security.routeId).toBe('scans:share');
    expect(POST.security.auth).toBe('required');
  });
});
