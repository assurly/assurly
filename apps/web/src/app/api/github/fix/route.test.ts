import { beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from './route';
import { AutoFixAlreadyAppliedError, GitHubWriteAccessError } from '../../../../utils/githubApp';
import { resetRateLimitsForTests } from '../../../../utils/rateLimit';

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  executeGitHubFixPullRequest: vi.fn(),
}));

vi.mock('../../../../utils/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../utils/auth')>()),
  requireUser: mocks.requireUser,
}));

vi.mock('../../../../utils/githubFixPipeline', () => ({
  executeGitHubFixPullRequest: mocks.executeGitHubFixPullRequest,
}));

const repoId = '11000000-0000-4000-8000-000000000001';
const scanId = '22000000-0000-4000-8000-000000000002';
const findingId = '33000000-0000-4000-8000-000000000003';

const db = {
  getFinding: vi.fn(),
  getScan: vi.fn(),
  getRepository: vi.fn(),
  getOrganization: vi.fn(),
  getMembership: vi.fn(),
  getScanFindings: vi.fn(),
  updateFindingFixPrUrl: vi.fn(),
  updateFindingFixPrUrls: vi.fn(),
};

function fixRequest(body: Record<string, unknown>): Request {
  return new Request('http://localhost/api/github/fix', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('GitHub fix tenant isolation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetRateLimitsForTests();
    mocks.requireUser.mockResolvedValue({
      user: { id: 'user-a', name: 'A', email: '', avatar_url: '' },
      accessToken: 'verified',
      db,
    });
    db.getFinding.mockResolvedValue({
      id: findingId,
      scan_id: scanId,
      file_path: 'database.sql',
      message: "Supabase table 'attempts' is created but Row-Level Security (RLS) is not enabled.",
    });
    db.getScan.mockResolvedValue({ id: scanId, repository_id: repoId, branch: 'main' });
    db.getRepository.mockResolvedValue({
      id: repoId,
      organization_id: 'org-b',
      name: 'acme/app',
      github_repo_id: 123,
    });
    db.getOrganization.mockResolvedValue({ id: 'org-b', github_installation_id: '140302856' });
    db.getMembership.mockResolvedValue(null);
  });

  it('does not act on another tenant finding even with every UUID', async () => {
    const response = await POST(fixRequest({ repoId, scanId, findingId }));
    expect(response.status).toBe(404);
    expect(mocks.executeGitHubFixPullRequest).not.toHaveBeenCalled();
  });
});

describe('GitHub fix auto-fix flow (POST /api/github/fix)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetRateLimitsForTests();
    mocks.requireUser.mockResolvedValue({
      user: { id: 'user-a', name: 'A', email: '', avatar_url: '' },
      accessToken: 'verified',
      db,
    });
    db.getFinding.mockResolvedValue({
      id: findingId,
      scan_id: scanId,
      file_path: 'database.sql',
      message: "Supabase table 'attempts' is created but Row-Level Security (RLS) is not enabled.",
    });
    db.getScan.mockResolvedValue({ id: scanId, repository_id: repoId, branch: 'main' });
    db.getRepository.mockResolvedValue({
      id: repoId,
      organization_id: 'org-b',
      name: 'acme/app',
      github_repo_id: 123,
    });
    db.getOrganization.mockResolvedValue({ id: 'org-b', github_installation_id: '140302856' });
    db.getMembership.mockResolvedValue({
      user_id: 'user-a',
      organization_id: 'org-b',
    });
    mocks.executeGitHubFixPullRequest.mockResolvedValue('https://github.com/acme/app/pull/7');
    db.updateFindingFixPrUrls.mockResolvedValue(undefined);
  });

  it('creates a pull request for a Supabase RLS finding and persists the link', async () => {
    const response = await POST(fixRequest({ repoId, scanId, findingId }));
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.prUrl).toBe('https://github.com/acme/app/pull/7');
    expect(body.findingIds).toEqual([findingId]);
    expect(mocks.executeGitHubFixPullRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        repositoryName: 'acme/app',
        branchSeed: findingId,
      }),
    );
    expect(db.updateFindingFixPrUrls).toHaveBeenCalledWith([
      { findingId, fixPrUrl: 'https://github.com/acme/app/pull/7' },
    ]);
  });

  it('returns an existing PR URL without calling GitHub again', async () => {
    db.getFinding.mockResolvedValue({
      id: findingId,
      scan_id: scanId,
      file_path: 'database.sql',
      fix_pr_url: 'https://github.com/acme/app/pull/99',
      message: "Supabase table 'attempts' is created but Row-Level Security (RLS) is not enabled.",
    });

    const response = await POST(fixRequest({ repoId, scanId, findingId }));
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.prUrl).toBe('https://github.com/acme/app/pull/99');
    expect(mocks.executeGitHubFixPullRequest).not.toHaveBeenCalled();
  });

  it('creates one batch pull request for all pending fixable findings', async () => {
    const findingTwo = '44000000-0000-4000-8000-000000000004';
    db.getScanFindings.mockResolvedValue([
      {
        id: findingId,
        scan_id: scanId,
        severity: 'error',
        file_path: 'database.sql',
        message:
          "Supabase table 'attempts' is created but Row-Level Security (RLS) is not enabled.",
      },
      {
        id: findingTwo,
        scan_id: scanId,
        severity: 'error',
        file_path: 'database.sql',
        message: "Supabase table 'config' is created but Row-Level Security (RLS) is not enabled.",
      },
    ]);
    mocks.executeGitHubFixPullRequest.mockResolvedValue('https://github.com/acme/app/pull/8');

    const response = await POST(fixRequest({ repoId, scanId, batch: true }));
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.prUrl).toBe('https://github.com/acme/app/pull/8');
    expect(body.findingIds).toEqual([findingId, findingTwo]);
    expect(mocks.executeGitHubFixPullRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        branchSeed: `batch:${scanId}`,
      }),
    );
  });

  it('maps an already-applied batch fix to a 409 with an accurate message', async () => {
    db.getScanFindings.mockResolvedValue([
      {
        id: findingId,
        scan_id: scanId,
        severity: 'error',
        file_path: 'database.sql',
        message:
          "Supabase table 'attempts' is created but Row-Level Security (RLS) is not enabled.",
      },
    ]);
    mocks.executeGitHubFixPullRequest.mockRejectedValue(new AutoFixAlreadyAppliedError());

    const response = await POST(fixRequest({ repoId, scanId, batch: true }));
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.error.code).toBe('fix_already_applied');
  });

  it('maps write failures to github_write_permission_required', async () => {
    mocks.executeGitHubFixPullRequest.mockRejectedValue(
      new GitHubWriteAccessError('Sign in again and approve repository access.'),
    );

    const response = await POST(fixRequest({ repoId, scanId, findingId }));
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error.code).toBe('github_write_permission_required');
  });

  it('maps an already-applied fix to a 409 with an accurate message, not a generic GitHub error', async () => {
    mocks.executeGitHubFixPullRequest.mockRejectedValue(new AutoFixAlreadyAppliedError());

    const response = await POST(fixRequest({ repoId, scanId, findingId }));
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.error.code).toBe('fix_already_applied');
    expect(body.error.message).toBe('This fix has already been applied.');
  });
});
