import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GET, POST } from './route';

const mocks = vi.hoisted(() => ({ requireUser: vi.fn() }));
vi.mock('../../../utils/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../utils/auth')>()),
  requireUser: mocks.requireUser,
}));

const db = {
  getRepository: vi.fn(),
  getOrganization: vi.fn(),
  getMembership: vi.fn(),
  getScan: vi.fn(),
  getRecentScans: vi.fn(),
  getScanFindings: vi.fn(),
  saveScan: vi.fn(),
};

describe('/api/scans tenant isolation', () => {
  const repoId = '11000000-0000-4000-8000-000000000001';
  const scanId = '22000000-0000-4000-8000-000000000002';
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireUser.mockResolvedValue({
      user: { id: 'user-a', name: 'A', email: '', avatar_url: '' },
      accessToken: 'verified',
      db,
    });
    db.getOrganization.mockResolvedValue({ id: 'org-b' });
    db.getMembership.mockResolvedValue(null);
    db.getRepository.mockResolvedValue({
      id: repoId,
      organization_id: 'org-b',
    });
    db.getScan.mockResolvedValue({ id: scanId, repository_id: repoId });
  });

  it('blocks history reads using another tenant repository UUID', async () => {
    const response = await GET(new Request(`http://localhost/api/scans?repoId=${repoId}`));
    expect(response.status).toBe(404);
    expect(db.getRecentScans).not.toHaveBeenCalled();
  });

  it('blocks finding reads using another tenant scan UUID', async () => {
    const response = await GET(new Request(`http://localhost/api/scans?scanId=${scanId}`));
    expect(response.status).toBe(404);
    expect(db.getScanFindings).not.toHaveBeenCalled();
  });

  it('blocks writes using another tenant repository UUID', async () => {
    const response = await POST(
      new Request('http://localhost/api/scans', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          repoId,
          commitSha: 'abcdef1',
          branch: 'main',
          status: 'success',
          errors: 0,
          warnings: 0,
          findings: [],
        }),
      }),
    );
    expect(response.status).toBe(404);
    expect(db.saveScan).not.toHaveBeenCalled();
  });
});

/**
 * The dashboard scanner persists results through POST /api/scans. These tests pin
 * the payload contract the client must satisfy so that a "Run Secure Scan" never
 * silently fails to save (the regression behind the empty "No scans found" state).
 */
describe('/api/scans persistence contract', () => {
  const repoId = '11000000-0000-4000-8000-000000000001';

  const finding = (severity: 'error' | 'warning', index: number) => ({
    rule_id: 'rls-check',
    severity,
    file_path: `db/migration_${index}.sql`,
    line_number: 1,
    message: `Finding ${index}`,
    suggestion: 'Fix it.',
  });

  const postScan = (body: unknown): Promise<Response> =>
    POST(
      new Request('http://localhost/api/scans', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    );

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireUser.mockResolvedValue({
      user: { id: 'user-a', name: 'A', email: '', avatar_url: '' },
      accessToken: 'verified',
      db,
    });
    // Caller is a member of the org that owns the repository → access granted.
    db.getRepository.mockResolvedValue({ id: repoId, organization_id: 'org-a' });
    db.getOrganization.mockResolvedValue({ id: 'org-a' });
    db.getMembership.mockResolvedValue({ id: 'membership-a', role: 'admin' });
    db.saveScan.mockImplementation(
      async (
        repository_id: string,
        commit_sha: string,
        branch: string,
        status: 'success' | 'failed',
        error_count: number,
        warning_count: number,
      ) => ({
        id: '33000000-0000-4000-8000-000000000003',
        repository_id,
        commit_sha,
        branch,
        status,
        error_count,
        warning_count,
        created_at: '2026-06-22T00:00:00.000Z',
      }),
    );
  });

  it('persists a well-formed payload whose counts match its findings', async () => {
    const response = await postScan({
      repoId,
      commitSha: 'abcdef1',
      branch: 'main',
      status: 'failed',
      errors: 1,
      warnings: 1,
      findings: [finding('error', 0), finding('warning', 1)],
    });

    expect(response.status).toBe(201);
    expect(db.saveScan).toHaveBeenCalledTimes(1);
    expect(db.saveScan).toHaveBeenCalledWith(
      repoId,
      'abcdef1',
      'main',
      'failed',
      1,
      1,
      expect.arrayContaining([expect.objectContaining({ severity: 'error' })]),
    );
  });

  it('accepts exactly the maximum of 100 findings', async () => {
    const findings = Array.from({ length: 100 }, (_, i) => finding('error', i));
    const response = await postScan({
      repoId,
      commitSha: 'abcdef1',
      branch: 'main',
      status: 'failed',
      errors: 100,
      warnings: 0,
      findings,
    });

    expect(response.status).toBe(201);
    expect(db.saveScan).toHaveBeenCalledTimes(1);
  });

  it('rejects payloads exceeding the 100 findings limit without touching the database', async () => {
    const findings = Array.from({ length: 101 }, (_, i) => finding('error', i));
    const response = await postScan({
      repoId,
      commitSha: 'abcdef1',
      branch: 'main',
      status: 'failed',
      errors: 101,
      warnings: 0,
      findings,
    });

    expect(response.status).toBe(400);
    expect(db.saveScan).not.toHaveBeenCalled();
  });

  it('rejects a payload whose reported counts disagree with its findings', async () => {
    const response = await postScan({
      repoId,
      commitSha: 'abcdef1',
      branch: 'main',
      status: 'failed',
      errors: 5,
      warnings: 0,
      findings: [finding('error', 0)],
    });

    expect(response.status).toBe(400);
    expect(db.saveScan).not.toHaveBeenCalled();
  });
});
