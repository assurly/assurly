import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getGitHubInstallation: vi.fn(),
  getInstallationAccessToken: vi.fn(),
}));

vi.mock('./githubApp', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./githubApp')>()),
  getGitHubInstallation: mocks.getGitHubInstallation,
  getInstallationAccessToken: mocks.getInstallationAccessToken,
}));

import { syncInstallationRepositories } from './githubInstallationSync';

function repositoryPage(count: number, offset = 0) {
  return new Response(
    JSON.stringify({
      repositories: Array.from({ length: count }, (_, index) => ({
        id: offset + index + 1,
        full_name: `tibco87/app-${offset + index + 1}`,
      })),
    }),
    { status: 200 },
  );
}

describe('syncInstallationRepositories', () => {
  const db = {
    getOrganizationByGitHubInstallationId: vi.fn(),
    connectGitHubInstallation: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getGitHubInstallation.mockResolvedValue({ account: { id: 99 } });
    mocks.getInstallationAccessToken.mockResolvedValue('installation-token');
    db.connectGitHubInstallation.mockImplementation(
      async (_org, _account, _id, repos) => repos.length,
    );
  });

  it('maps every repository GitHub now grants onto the connected workspace', async () => {
    db.getOrganizationByGitHubInstallationId.mockResolvedValue({ id: 'org-1' });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(repositoryPage(100))
      .mockResolvedValueOnce(repositoryPage(15, 100));
    vi.stubGlobal('fetch', fetchMock);

    await expect(syncInstallationRepositories(db, '456')).resolves.toBe(115);

    expect(db.connectGitHubInstallation).toHaveBeenCalledWith(
      'org-1',
      99,
      '456',
      expect.arrayContaining([{ id: 115, fullName: 'tibco87/app-115' }]),
    );
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer installation-token');
  });

  it('leaves an installation no workspace has connected yet to the install callback', async () => {
    db.getOrganizationByGitHubInstallationId.mockResolvedValue(null);
    vi.stubGlobal('fetch', vi.fn());

    await expect(syncInstallationRepositories(db, '456')).resolves.toBeNull();
    expect(db.connectGitHubInstallation).not.toHaveBeenCalled();
  });

  it('changes nothing when GitHub cannot list the repositories', async () => {
    db.getOrganizationByGitHubInstallationId.mockResolvedValue({ id: 'org-1' });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 503 })));

    await expect(syncInstallationRepositories(db, '456')).rejects.toThrow('GitHub is unavailable');
    expect(db.connectGitHubInstallation).not.toHaveBeenCalled();
  });
});
