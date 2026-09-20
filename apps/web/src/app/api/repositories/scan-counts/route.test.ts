import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthenticationError } from '../../../../utils/auth';
import { GET } from './route';

const mocks = vi.hoisted(() => ({ requireUser: vi.fn() }));
vi.mock('../../../../utils/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../utils/auth')>()),
  requireUser: mocks.requireUser,
}));

const db = {
  getOrganizationByUserId: vi.fn(),
  getRepositories: vi.fn(),
  listScanHistoryRows: vi.fn(),
};

function request(): Request {
  return new Request('http://localhost/api/repositories/scan-counts');
}

describe('GET /api/repositories/scan-counts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireUser.mockResolvedValue({
      user: { id: 'user-a', name: 'A', email: '', avatar_url: '' },
      accessToken: 'verified',
      db,
    });
    db.getOrganizationByUserId.mockResolvedValue({ id: 'org-a' });
    db.getRepositories.mockResolvedValue([
      { id: 'repo-a', organization_id: 'org-a' },
      { id: 'repo-b', organization_id: 'org-a' },
      { id: 'repo-c', organization_id: 'org-a' },
    ]);
    db.listScanHistoryRows.mockResolvedValue([
      { repository_id: 'repo-a', failure_reason: null },
      { repository_id: 'repo-a', failure_reason: 'no_eligible_files' },
      { repository_id: 'repo-a', failure_reason: 'too_large' },
      { repository_id: 'repo-b', failure_reason: 'too_large' },
    ]);
  });

  it('returns 401 when unauthenticated', async () => {
    mocks.requireUser.mockRejectedValue(new AuthenticationError());
    const response = await GET(request());
    expect(response.status).toBe(401);
    expect(db.listScanHistoryRows).not.toHaveBeenCalled();
  });

  it('returns one visible-history count per repository of the caller organization, zeros included', async () => {
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      counts: { 'repo-a': 2, 'repo-b': 0, 'repo-c': 0 },
    });
    // One read for the whole organization — never one per repository.
    expect(db.listScanHistoryRows).toHaveBeenCalledTimes(1);
    expect(db.listScanHistoryRows).toHaveBeenCalledWith(['repo-a', 'repo-b', 'repo-c']);
  });

  it('never counts a repository the organization does not own', async () => {
    db.listScanHistoryRows.mockResolvedValue([
      { repository_id: 'repo-a', failure_reason: null },
      { repository_id: 'repo-foreign', failure_reason: null },
    ]);
    const response = await GET(request());
    expect(await response.json()).toEqual({
      counts: { 'repo-a': 1, 'repo-b': 0, 'repo-c': 0 },
    });
  });

  it('returns empty counts without touching scans when the user has no organization', async () => {
    db.getOrganizationByUserId.mockResolvedValue(null);
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ counts: {} });
    expect(db.listScanHistoryRows).not.toHaveBeenCalled();
  });
});
