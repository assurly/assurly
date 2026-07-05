import crypto from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  after: vi.fn(),
  getAdminDbAdapter: vi.fn(),
  getInstallationAccessToken: vi.fn(),
}));

vi.mock('next/server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/server')>()),
  after: mocks.after,
}));
vi.mock('../../../../utils/dbAdapter', () => ({
  getAdminDbAdapter: mocks.getAdminDbAdapter,
}));
vi.mock('../../../../utils/githubApp', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../utils/githubApp')>()),
  getInstallationAccessToken: mocks.getInstallationAccessToken,
}));
vi.mock('../../../../utils/scanRegression', () => ({
  notifyIfRegressionBlockers: vi.fn().mockResolvedValue(undefined),
}));

import { getScannerFileLimit, POST } from './route';
import { notifyIfRegressionBlockers } from '../../../../utils/scanRegression';

const db = {
  claimGitHubDelivery: vi.fn(),
  finishGitHubDelivery: vi.fn(),
  getRepositoryByGithubRepoId: vi.fn(),
  saveScan: vi.fn(),
  getRecentScans: vi.fn(),
  getScanFindings: vi.fn(),
};

function request(overrides: { body?: string; secret?: string; delivery?: string } = {}) {
  const body =
    overrides.body ||
    JSON.stringify({
      action: 'opened',
      installation: { id: 456 },
      repository: { id: 42, full_name: 'owner/private-repo' },
      pull_request: { head: { sha: 'a'.repeat(40), ref: 'feature/a' } },
    });
  const secret = overrides.secret || 'webhook-secret';
  return new Request('http://localhost/api/github/webhook', {
    method: 'POST',
    headers: {
      'x-github-event': 'pull_request',
      'x-github-delivery': overrides.delivery ?? 'delivery-1',
      'x-hub-signature-256': `sha256=${crypto.createHmac('sha256', secret).update(body).digest('hex')}`,
    },
    body,
  });
}

describe('GitHub webhook security and idempotency', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.GITHUB_WEBHOOK_SECRET = 'webhook-secret';
    mocks.getAdminDbAdapter.mockReturnValue(db);
    db.claimGitHubDelivery.mockResolvedValue(true);
    db.getRepositoryByGithubRepoId.mockResolvedValue({ id: 'repo-uuid' });
    db.finishGitHubDelivery.mockResolvedValue(undefined);
    db.saveScan.mockResolvedValue({ id: 'scan-new', created_at: '2026-01-02T00:00:00.000Z' });
    db.getRecentScans.mockResolvedValue([
      { id: 'scan-new', created_at: '2026-01-02T00:00:00.000Z' },
      { id: 'scan-old', created_at: '2026-01-01T00:00:00.000Z' },
    ]);
    db.getScanFindings.mockResolvedValue([]);
    mocks.getInstallationAccessToken.mockResolvedValue('installation-token');
  });

  it('uses a bounded configurable scanner budget', () => {
    expect(getScannerFileLimit('250')).toBe(250);
    expect(getScannerFileLimit('0')).toBe(1);
    expect(getScannerFileLimit('50000')).toBe(1000);
    expect(getScannerFileLimit('invalid')).toBe(100);
  });

  it('fails closed when the webhook secret is absent', async () => {
    delete process.env.GITHUB_WEBHOOK_SECRET;
    expect((await POST(request())).status).toBe(503);
    expect(mocks.getAdminDbAdapter).not.toHaveBeenCalled();
  });

  it('rejects invalid signatures before database access', async () => {
    expect((await POST(request({ secret: 'wrong-secret' }))).status).toBe(401);
    expect(mocks.getAdminDbAdapter).not.toHaveBeenCalled();
  });

  it('requires a delivery ID for actionable events', async () => {
    const req = request();
    req.headers.delete('x-github-delivery');
    expect((await POST(req)).status).toBe(400);
    expect(db.claimGitHubDelivery).not.toHaveBeenCalled();
  });

  it('does not schedule a duplicate delivery', async () => {
    db.claimGitHubDelivery.mockResolvedValue(false);
    expect((await POST(request())).status).toBe(200);
    expect(mocks.after).not.toHaveBeenCalled();
  });

  it('does not schedule a repository mapped to another installation', async () => {
    db.claimGitHubDelivery.mockRejectedValue(new Error('installation mismatch'));
    expect((await POST(request())).status).toBe(500);
    expect(mocks.after).not.toHaveBeenCalled();
    expect(db.getRepositoryByGithubRepoId).not.toHaveBeenCalled();
  });

  it('runs accepted work in after() with a repository-scoped installation token', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 99 }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ tree: [] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({}), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    expect((await POST(request())).status).toBe(202);
    expect(db.claimGitHubDelivery).toHaveBeenCalledWith('delivery-1', 'pull_request', 42, '456');
    expect(mocks.after).toHaveBeenCalledOnce();
    const work = mocks.after.mock.calls[0][0] as () => Promise<void>;
    await work();

    expect(mocks.getInstallationAccessToken).toHaveBeenCalledWith('456', 42);
    expect(db.saveScan).toHaveBeenCalledWith(
      'repo-uuid',
      'a'.repeat(40),
      'feature/a',
      'success',
      0,
      0,
      [],
    );
    expect(db.finishGitHubDelivery).toHaveBeenCalledWith('delivery-1', true);
    expect(
      fetchMock.mock.calls.every(
        ([, options]) => options.headers.Authorization === 'Bearer installation-token',
      ),
    ).toBe(true);
  });

  it('fires a regression alert once when a previous scan exists', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 99 }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ tree: [] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({}), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    expect((await POST(request())).status).toBe(202);
    const work = mocks.after.mock.calls[0][0] as () => Promise<void>;
    await work();

    expect(notifyIfRegressionBlockers).toHaveBeenCalledOnce();
  });

  it('does not fire a regression alert when there is no previous scan', async () => {
    db.getRecentScans.mockResolvedValue([
      { id: 'scan-new', created_at: '2026-01-02T00:00:00.000Z' },
    ]);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 99 }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ tree: [] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({}), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    expect((await POST(request())).status).toBe(202);
    const work = mocks.after.mock.calls[0][0] as () => Promise<void>;
    await work();

    expect(notifyIfRegressionBlockers).not.toHaveBeenCalled();
  });
});
