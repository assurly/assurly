import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthenticationError } from '../../../utils/auth';
import { POST } from './route';

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  reconnectRepository: vi.fn(),
}));
vi.mock('../../../utils/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../utils/auth')>()),
  requireUser: mocks.requireUser,
}));
vi.mock('../../../utils/dbAdapter', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../utils/dbAdapter')>()),
  getAdminDbAdapter: () => ({ reconnectRepository: mocks.reconnectRepository }),
}));

const db = {
  getOrganizationByUserId: vi.fn(),
  getOrganization: vi.fn(),
  getMembership: vi.fn(),
  getRepositories: vi.fn(),
  getRepository: vi.fn(),
  getRepositoryByGithubRepoId: vi.fn(),
  addRepository: vi.fn(),
};

describe('POST /api/repositories tenant boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireUser.mockResolvedValue({
      user: { id: 'user-a', name: 'A', email: '', avatar_url: '' },
      accessToken: 'verified',
      db,
    });
    db.getOrganization.mockResolvedValue({ id: 'org-a' });
    db.getOrganizationByUserId.mockResolvedValue({ id: 'org-a' });
    db.getMembership.mockResolvedValue({
      user_id: 'user-a',
      organization_id: 'org-a',
      role: 'admin',
    });
    db.getRepositories.mockResolvedValue([]);
    db.getRepositoryByGithubRepoId.mockResolvedValue(null);
    db.getRepository.mockResolvedValue(null);
    db.addRepository.mockResolvedValue({
      id: 'repo-a',
      organization_id: 'org-a',
      name: 'owner/repo',
      github_repo_id: 123,
    });
  });

  it('returns 401 when unauthenticated', async () => {
    mocks.requireUser.mockRejectedValue(new AuthenticationError());
    const response = await POST(
      new Request('http://localhost/api/repositories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'owner/repo', githubRepoId: 123 }),
      }),
    );
    expect(response.status).toBe(401);
  });

  it('denies a known organization UUID without membership', async () => {
    db.getMembership.mockResolvedValue(null);
    const response = await POST(
      new Request('http://localhost/api/repositories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'victim/private',
          githubRepoId: 999,
        }),
      }),
    );
    expect(response.status).toBe(404);
    expect(db.addRepository).not.toHaveBeenCalled();
  });

  it('creates a repository inside the verified organization', async () => {
    const response = await POST(
      new Request('http://localhost/api/repositories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'owner/repo',
          githubRepoId: 123,
        }),
      }),
    );
    expect(response.status).toBe(201);
    expect(db.addRepository).toHaveBeenCalledWith('org-a', 'owner/repo', 123);
  });

  it('reactivates a dismissed repository instead of inserting a duplicate', async () => {
    db.getRepositoryByGithubRepoId.mockResolvedValue({
      id: 'repo-hidden',
      organization_id: 'org-a',
      name: 'owner/old-name',
      github_repo_id: 123,
      is_active: false,
    });
    db.getRepository.mockResolvedValue({
      id: 'repo-hidden',
      organization_id: 'org-a',
      name: 'owner/repo',
      github_repo_id: 123,
      is_active: true,
    });

    const response = await POST(
      new Request('http://localhost/api/repositories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'owner/repo',
          githubRepoId: 123,
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(mocks.reconnectRepository).toHaveBeenCalledWith('repo-hidden', 'owner/repo');
    expect(db.addRepository).not.toHaveBeenCalled();
    expect(await response.json()).toMatchObject({ id: 'repo-hidden', is_active: true });
  });

  it('reconnects a repository the user dismissed but that is still reachable', async () => {
    db.getRepositoryByGithubRepoId.mockResolvedValue({
      id: 'repo-dismissed',
      organization_id: 'org-a',
      name: 'owner/repo',
      github_repo_id: 123,
      is_active: true,
      dismissed_at: '2026-08-20T00:00:00Z',
    });
    db.getRepository.mockResolvedValue({
      id: 'repo-dismissed',
      organization_id: 'org-a',
      name: 'owner/repo',
      github_repo_id: 123,
      is_active: true,
      dismissed_at: null,
    });

    const response = await POST(
      new Request('http://localhost/api/repositories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'owner/repo', githubRepoId: 123 }),
      }),
    );

    expect(response.status).toBe(200);
    expect(mocks.reconnectRepository).toHaveBeenCalledWith('repo-dismissed', 'owner/repo');
    expect(await response.json()).toMatchObject({ dismissed_at: null });
  });

  it('rejects a GitHub repository already connected to another organization', async () => {
    db.getRepositoryByGithubRepoId.mockResolvedValue({
      id: 'repo-other',
      organization_id: 'org-b',
      name: 'victim/private',
      github_repo_id: 999,
      is_active: true,
    });

    const response = await POST(
      new Request('http://localhost/api/repositories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'victim/private',
          githubRepoId: 999,
        }),
      }),
    );

    expect(response.status).toBe(409);
    expect(db.addRepository).not.toHaveBeenCalled();
  });
});
