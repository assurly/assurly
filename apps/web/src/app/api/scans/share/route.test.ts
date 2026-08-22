import { beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from './route';

const mocks = vi.hoisted(() => ({ requireUser: vi.fn() }));
vi.mock('../../../../utils/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../utils/auth')>()),
  requireUser: mocks.requireUser,
}));

vi.mock('../../../../utils/env', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../utils/env')>()),
  getApplicationUrl: () => 'https://assurly.dev',
}));

const repoId = '11000000-0000-4000-8000-000000000001';
const scanId = '22000000-0000-4000-8000-000000000002';

const db = {
  getOrganizationByUserId: vi.fn(),
  getRepository: vi.fn(),
  getOrganization: vi.fn(),
  getMembership: vi.fn(),
  getScan: vi.fn(),
  setScanShareToken: vi.fn(),
};

const share = (body: unknown = { scanId }): Promise<Response> =>
  POST(
    new Request('http://localhost/api/scans/share', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );

describe('POST /api/scans/share', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireUser.mockResolvedValue({
      user: { id: 'user-a', name: 'A', email: '', avatar_url: '' },
      accessToken: 'verified',
      db,
    });
    db.getOrganizationByUserId.mockResolvedValue({ id: 'org-a', billing_plan: 'pro' });
    db.getRepository.mockResolvedValue({ id: repoId, organization_id: 'org-a' });
    db.getOrganization.mockResolvedValue({ id: 'org-a' });
    db.getMembership.mockResolvedValue({ id: 'membership-a', role: 'admin' });
    db.getScan.mockResolvedValue({ id: scanId, repository_id: repoId, share_token: null });
    db.setScanShareToken.mockImplementation(async (_id: string, token: string) => ({
      id: scanId,
      repository_id: repoId,
      share_token: token,
    }));
  });

  it('pins the route security contract', () => {
    expect(POST.security.routeId).toBe('scans:share');
    expect(POST.security.auth).toBe('required');
    expect(POST.security.csrf).toBe(true);
  });

  it('mints a token and returns the public report URL', async () => {
    const response = await share();

    expect(response.status).toBe(200);
    const payload = (await response.json()) as { token: string; url: string };
    expect(db.setScanShareToken).toHaveBeenCalledTimes(1);
    expect(payload.token).toMatch(/^[0-9a-f]{32}$/);
    expect(payload.url).toBe(`https://assurly.dev/report/${payload.token}`);
  });

  it('reuses an existing token instead of minting a second one', async () => {
    db.getScan.mockResolvedValue({
      id: scanId,
      repository_id: repoId,
      share_token: 'already-shared',
    });

    const response = await share();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      token: 'already-shared',
      url: 'https://assurly.dev/report/already-shared',
    });
    expect(db.setScanShareToken).not.toHaveBeenCalled();
  });

  it('rejects a free organization', async () => {
    db.getOrganizationByUserId.mockResolvedValue({ id: 'org-a', billing_plan: 'free' });

    const response = await share();

    expect(response.status).toBe(403);
    expect(db.setScanShareToken).not.toHaveBeenCalled();
  });

  it('mints a token for an OEM organization', async () => {
    db.getOrganizationByUserId.mockResolvedValue({ id: 'org-a', billing_plan: 'oem' });

    const response = await share();

    expect(response.status).toBe(200);
    expect(db.setScanShareToken).toHaveBeenCalledTimes(1);
  });

  it('blocks a scan belonging to another tenant', async () => {
    db.getMembership.mockResolvedValue(null);

    const response = await share();

    expect(response.status).toBe(404);
    expect(db.setScanShareToken).not.toHaveBeenCalled();
  });

  /**
   * Regression: public.scans carried no UPDATE grant/policy, so writing the token
   * failed with "permission denied" — a message the old guard (which only matched
   * a missing COLUMN) let through as a bare 500. The button read "Internal server
   * error" with nothing actionable. Every environment-shaped failure must degrade
   * to 503 share_unavailable instead. See 20260720000000_scan_share_token_update.
   */
  it.each([
    ['permission denied', 'Supabase request failed (403): permission denied for table scans'],
    ['row-level security', 'new row violates row-level security policy for table "scans"'],
    ['no matching row', `Supabase update matched no scan row (${scanId}).`],
    ['missing column', "Could not find the 'share_token' column of 'scans' in the schema cache"],
  ])('degrades a %s failure to an actionable 503', async (_label, message) => {
    db.setScanShareToken.mockRejectedValue(new Error(message));

    const response = await share();

    expect(response.status).toBe(503);
    const payload = (await response.json()) as { error: { code: string; message: string } };
    expect(payload.error.code).toBe('share_unavailable');
    expect(payload.error.message).toMatch(/database migration/i);
  });

  it('still surfaces an unrelated failure as a 500 rather than mislabelling it', async () => {
    db.setScanShareToken.mockRejectedValue(new Error('socket hang up'));

    const response = await share();

    expect(response.status).toBe(500);
  });
});
