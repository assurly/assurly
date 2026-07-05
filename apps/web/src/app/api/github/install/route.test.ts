import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  getAdminDbAdapter: vi.fn(),
  getGitHubInstallation: vi.fn(),
  getInstallationAccessToken: vi.fn(),
}));
vi.mock('../../../../utils/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../utils/auth')>()),
  requireUser: mocks.requireUser,
}));
vi.mock('../../../../utils/dbAdapter', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../utils/dbAdapter')>()),
  getAdminDbAdapter: mocks.getAdminDbAdapter,
}));
vi.mock('../../../../utils/githubApp', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../utils/githubApp')>()),
  getGitHubInstallation: mocks.getGitHubInstallation,
  getInstallationAccessToken: mocks.getInstallationAccessToken,
}));

import { createGitHubInstallationState } from '../../../../utils/githubApp';
import { GET } from './route';

const userDb = {
  getOrganization: vi.fn(),
  getMembership: vi.fn(),
  getOrganizationByUserId: vi.fn(),
};
const adminDb = { connectGitHubInstallation: vi.fn() };

describe('GitHub installation callback mapping', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.APP_URL = 'https://shipready.example';
    process.env.GITHUB_STATE_SECRET = 'state-secret-with-at-least-thirty-two-bytes';
    mocks.requireUser.mockResolvedValue({ user: { id: 'user-a' }, db: userDb });
    userDb.getOrganization.mockResolvedValue({ id: 'org-a' });
    userDb.getMembership.mockResolvedValue({ user_id: 'user-a', organization_id: 'org-a' });
    userDb.getOrganizationByUserId.mockResolvedValue({
      id: 'org-a',
      github_installation_id: '456',
    });
    mocks.getAdminDbAdapter.mockReturnValue(adminDb);
    mocks.getGitHubInstallation.mockResolvedValue({ account: { id: 9001 } });
    mocks.getInstallationAccessToken.mockResolvedValue('installation-token');
    adminDb.connectGitHubInstallation.mockResolvedValue(1);
  });

  it('rejects state belonging to a different authenticated user', async () => {
    const state = createGitHubInstallationState('user-b', 'org-b');
    const response = await GET(
      new Request(
        `https://shipready.example/api/github/install?installation_id=456&state=${encodeURIComponent(state)}`,
      ),
    );
    expect(response.status).toBe(403);
    expect((await response.json()).error.code).toBe('invalid_install_state');
    expect(mocks.getGitHubInstallation).not.toHaveBeenCalled();
    expect(adminDb.connectGitHubInstallation).not.toHaveBeenCalled();
  });

  it('accepts GitHub setup redirects that omit state but include setup_action', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ repositories: [{ id: 42, full_name: 'owner/private-repo' }] }),
      }),
    );
    const response = await GET(
      new Request(
        'https://shipready.example/api/github/install?installation_id=456&setup_action=update',
      ),
    );
    expect(response.headers.get('location')).toBe(
      'https://shipready.example/dashboard?success=github_app_installed',
    );
    expect(adminDb.connectGitHubInstallation).toHaveBeenCalledWith('org-a', 9001, '456', [
      { id: 42, fullName: 'owner/private-repo' },
    ]);
  });

  it('rejects setup redirects for a different installation on the same workspace', async () => {
    const response = await GET(
      new Request(
        'https://shipready.example/api/github/install?installation_id=999&setup_action=update',
      ),
    );
    expect(response.status).toBe(403);
    expect((await response.json()).error.code).toBe('invalid_install_state');
    expect(adminDb.connectGitHubInstallation).not.toHaveBeenCalled();
  });

  it('maps GitHub account, installation, and repositories atomically to the signed tenant', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ repositories: [{ id: 42, full_name: 'owner/private-repo' }] }),
      }),
    );
    const state = createGitHubInstallationState('user-a', 'org-a');
    const response = await GET(
      new Request(
        `https://shipready.example/api/github/install?installation_id=456&state=${encodeURIComponent(state)}`,
      ),
    );
    expect(response.headers.get('location')).toBe(
      'https://shipready.example/dashboard?success=github_app_installed',
    );
    expect(mocks.getGitHubInstallation).toHaveBeenCalledWith('456');
    expect(adminDb.connectGitHubInstallation).toHaveBeenCalledWith('org-a', 9001, '456', [
      { id: 42, fullName: 'owner/private-repo' },
    ]);
  });
});
