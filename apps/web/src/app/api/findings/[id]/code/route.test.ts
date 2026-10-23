import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  getInstallationAccessToken: vi.fn(),
  loadFindingCode: vi.fn(),
}));
vi.mock('../../../../../utils/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../../utils/auth')>()),
  requireUser: mocks.requireUser,
}));
vi.mock('../../../../../utils/githubApp', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../../utils/githubApp')>()),
  getInstallationAccessToken: mocks.getInstallationAccessToken,
}));
vi.mock('../../../../../utils/findingCode', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../../utils/findingCode')>()),
  loadFindingCode: mocks.loadFindingCode,
}));

import { GET } from './route';

const FINDING_ID = '22222222-2222-4222-8222-222222222222';
const COMMIT = 'a'.repeat(40);

const finding = {
  id: FINDING_ID,
  scan_id: 'scan-1',
  rule_id: 'stripe-webhook-signature',
  severity: 'error',
  file_path: 'app/api/webhooks/stripe/route.ts',
  line_number: 6,
  message: 'Stripe webhook endpoint appears to lack signature verification.',
  created_at: '2026-10-23T10:00:00.000Z',
};

const db = {
  getFinding: vi.fn(),
  getScan: vi.fn(),
  getRepository: vi.fn(),
  getOrganization: vi.fn(),
  getMembership: vi.fn(),
};

function request(id = FINDING_ID) {
  return GET(new Request(`http://localhost/api/findings/${id}/code`), {
    params: Promise.resolve({ id }),
  });
}

describe('GET /api/findings/[id]/code', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('GITHUB_PAT', '');
    vi.stubEnv('GITHUB_TOKEN', '');
    mocks.requireUser.mockResolvedValue({ user: { id: 'user-1' }, accessToken: 'token', db });
    db.getFinding.mockResolvedValue(finding);
    db.getScan.mockResolvedValue({ id: 'scan-1', repository_id: 'repo-1', commit_sha: COMMIT });
    db.getRepository.mockResolvedValue({
      id: 'repo-1',
      organization_id: 'org-1',
      name: 'tibco87/notes',
      github_repo_id: 42,
    });
    db.getOrganization.mockResolvedValue({ id: 'org-1', github_installation_id: '456' });
    db.getMembership.mockResolvedValue({ role: 'owner' });
    mocks.getInstallationAccessToken.mockResolvedValue('installation-token');
    mocks.loadFindingCode.mockResolvedValue({ available: true, file: finding.file_path });
  });

  it('reads the finding at the scanned commit with the installation token first', async () => {
    const res = await request();

    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('private, no-store');
    expect(mocks.getInstallationAccessToken).toHaveBeenCalledWith('456', 42);
    expect(mocks.loadFindingCode).toHaveBeenCalledWith({
      repositoryName: 'tibco87/notes',
      commitSha: COMMIT,
      finding,
      tokens: ['installation-token', undefined],
    });
  });

  it('still reads a public repository when the installation cannot mint a token', async () => {
    mocks.getInstallationAccessToken.mockRejectedValue(new Error('not installed'));
    await request();
    expect(mocks.loadFindingCode.mock.calls[0][0].tokens).toEqual([undefined]);
  });

  it('never reads with the server PAT, which can see repositories this org does not own', async () => {
    vi.stubEnv('GITHUB_PAT', 'server-pat');
    mocks.getInstallationAccessToken.mockRejectedValue(new Error('not installed'));
    await request();
    expect(mocks.loadFindingCode.mock.calls[0][0].tokens).toEqual([undefined]);
  });

  it("reads with the signed-in user's own GitHub token after the installation", async () => {
    vi.stubEnv('GITHUB_PAT', 'server-pat');
    mocks.requireUser.mockResolvedValue({
      user: { id: 'user-1' },
      accessToken: 'token',
      githubAccessToken: 'user-gh-token',
      db,
    });
    await request();
    expect(mocks.loadFindingCode.mock.calls[0][0].tokens).toEqual([
      'installation-token',
      'user-gh-token',
      undefined,
    ]);
  });

  it('answers 404 for a finding in another organization, without touching GitHub', async () => {
    db.getMembership.mockResolvedValue(null);
    const res = await request();
    expect(res.status).toBe(404);
    expect(mocks.loadFindingCode).not.toHaveBeenCalled();
    expect(mocks.getInstallationAccessToken).not.toHaveBeenCalled();
  });

  it('answers 404 for an unknown finding', async () => {
    db.getFinding.mockResolvedValue(null);
    expect((await request()).status).toBe(404);
  });

  it('rejects an id that is not a uuid', async () => {
    expect((await request('find-0-abc')).status).toBe(400);
    expect(db.getFinding).not.toHaveBeenCalled();
  });

  it('requires a signed-in user', async () => {
    mocks.requireUser.mockRejectedValue(
      new (await import('../../../../../utils/auth')).AuthenticationError(),
    );
    expect((await request()).status).toBe(401);
  });
});
