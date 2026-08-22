import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthenticationError } from '../../../utils/auth';
import { DELETE, GET, POST } from './route';

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
  deleteScan: vi.fn(),
  upsertTarget: vi.fn(),
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
      expect.objectContaining({
        scannedFileCount: 2,
        shipScore: expect.any(Number),
        verdict: expect.stringMatching(/^(ready|review|blocked|failed)$/),
      }),
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

  it('stores a failed empty scan with a null ship score even if the client sends 0', async () => {
    const response = await postScan({
      repoId,
      commitSha: 'abcdef1',
      branch: 'src',
      status: 'failed',
      errors: 0,
      warnings: 0,
      findings: [],
      scannedFileCount: 0,
      cleanFileCount: 0,
      shipScore: 0,
      verdict: 'failed',
      failureReason: 'no_eligible_files',
    });

    expect(response.status).toBe(201);
    expect(db.saveScan).toHaveBeenCalledWith(
      repoId,
      'abcdef1',
      'src',
      'failed',
      0,
      0,
      [],
      expect.objectContaining({
        shipScore: null,
        verdict: 'failed',
        failureReason: 'no_eligible_files',
      }),
    );
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

describe('DELETE /api/scans', () => {
  const repoId = '11000000-0000-4000-8000-000000000001';
  const newestScanId = '22000000-0000-4000-8000-000000000002';
  const olderScanId = '22000000-0000-4000-8000-000000000003';

  const deleteScan = (scanId: string): Promise<Response> =>
    DELETE(new Request(`http://localhost/api/scans?scanId=${scanId}`, { method: 'DELETE' }));

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireUser.mockResolvedValue({
      user: { id: 'user-a', name: 'A', email: '', avatar_url: '' },
      accessToken: 'verified',
      db,
    });
    db.getRepository.mockResolvedValue({
      id: repoId,
      organization_id: 'org-a',
      name: 'acme/api',
    });
    db.getOrganization.mockResolvedValue({ id: 'org-a' });
    db.getMembership.mockResolvedValue({ id: 'membership-a', role: 'admin' });
    db.deleteScan.mockResolvedValue(undefined);
    db.upsertTarget.mockResolvedValue({});
    db.getScanFindings.mockResolvedValue([]);
  });

  it('returns 401 when unauthenticated', async () => {
    mocks.requireUser.mockRejectedValue(new AuthenticationError());
    const response = await deleteScan(newestScanId);
    expect(response.status).toBe(401);
    expect(db.deleteScan).not.toHaveBeenCalled();
  });

  it('returns 404 when the caller cannot access the scan', async () => {
    db.getScan.mockResolvedValue({
      id: newestScanId,
      repository_id: repoId,
      created_at: '2026-07-19T12:00:00.000Z',
    });
    db.getMembership.mockResolvedValue(null);

    const response = await deleteScan(newestScanId);
    expect(response.status).toBe(404);
    expect(db.deleteScan).not.toHaveBeenCalled();
  });

  it('deletes an owned scan', async () => {
    db.getScan.mockResolvedValue({
      id: newestScanId,
      repository_id: repoId,
      created_at: '2026-07-19T12:00:00.000Z',
    });
    db.getRecentScans.mockResolvedValue([
      { id: olderScanId, created_at: '2026-07-18T12:00:00.000Z' },
    ]);

    const response = await deleteScan(newestScanId);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(db.deleteScan).toHaveBeenCalledWith(newestScanId);
  });

  it('recomputes the target from the next-newest scan when deleting the newest', async () => {
    db.getScan.mockResolvedValue({
      id: newestScanId,
      repository_id: repoId,
      created_at: '2026-07-19T12:00:00.000Z',
    });
    db.getRecentScans.mockResolvedValue([
      { id: olderScanId, created_at: '2026-07-18T12:00:00.000Z' },
    ]);
    db.getScanFindings.mockResolvedValue([
      {
        id: 'finding-1',
        scan_id: olderScanId,
        rule_id: 'supabase-rls',
        severity: 'error',
        file_path: 'schema.sql',
        line_number: 1,
        message: "Supabase table 'users' lacks RLS.",
        created_at: '2026-07-18T12:00:00.000Z',
      },
    ]);

    const response = await deleteScan(newestScanId);
    expect(response.status).toBe(200);
    expect(db.getScanFindings).toHaveBeenCalledWith(olderScanId);
    expect(db.upsertTarget).toHaveBeenCalledWith(
      expect.objectContaining({
        repositoryId: repoId,
        currentVerdict: 'blocked',
        lastCheckedAt: '2026-07-18T12:00:00.000Z',
      }),
    );
  });

  it('resets the target to the neutral unknown verdict when deleting the last scan', async () => {
    db.getScan.mockResolvedValue({
      id: newestScanId,
      repository_id: repoId,
      created_at: '2026-07-19T12:00:00.000Z',
    });
    db.getRecentScans.mockResolvedValue([]);

    const response = await deleteScan(newestScanId);
    expect(response.status).toBe(200);
    expect(db.getScanFindings).not.toHaveBeenCalled();
    expect(db.upsertTarget).toHaveBeenCalledWith(
      expect.objectContaining({
        repositoryId: repoId,
        currentVerdict: 'unknown',
        currentShipScore: null,
        verdictEvidence: {},
        lastCheckedAt: null,
      }),
    );
  });

  it('leaves the target unchanged when deleting a non-newest scan', async () => {
    db.getScan.mockResolvedValue({
      id: olderScanId,
      repository_id: repoId,
      created_at: '2026-07-18T12:00:00.000Z',
    });
    // Newest survivor is still newer than the deleted scan.
    db.getRecentScans.mockResolvedValue([
      { id: newestScanId, created_at: '2026-07-19T12:00:00.000Z' },
    ]);

    const response = await deleteScan(olderScanId);
    expect(response.status).toBe(200);
    expect(db.deleteScan).toHaveBeenCalledWith(olderScanId);
    expect(db.getScanFindings).not.toHaveBeenCalled();
    expect(db.upsertTarget).not.toHaveBeenCalled();
  });
});
