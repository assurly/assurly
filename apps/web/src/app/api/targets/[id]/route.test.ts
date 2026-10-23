import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  adminDeleteTarget: vi.fn(),
}));
vi.mock('../../../../utils/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../utils/auth')>()),
  requireUser: mocks.requireUser,
}));
vi.mock('../../../../utils/dbAdapter', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../utils/dbAdapter')>()),
  getAdminDbAdapter: () => ({ deleteTarget: mocks.adminDeleteTarget }),
}));

import { DELETE, GET } from './route';

const TARGET_ID = '11111111-1111-4111-8111-111111111111';

const db = {
  getOrganizationByUserId: vi.fn(),
  getTargetById: vi.fn(),
  deleteTarget: vi.fn(),
  getLatestProbeEvidenceForTarget: vi.fn(),
  getFixOutcomesForTarget: vi.fn(),
  getLiveLockSummary: vi.fn(),
};

describe('DELETE /api/targets/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireUser.mockResolvedValue({
      user: { id: 'user-1' },
      accessToken: 'token',
      db,
    });
    db.getOrganizationByUserId.mockResolvedValue({ id: 'org-1' });
    mocks.adminDeleteTarget.mockResolvedValue(undefined);
  });

  it('deletes an owned URL target via the admin adapter', async () => {
    db.getTargetById.mockResolvedValue({
      id: TARGET_ID,
      organization_id: 'org-1',
      kind: 'url',
      identifier: 'https://myapp.lovable.app',
    });

    const res = await DELETE(
      new Request(`http://localhost/api/targets/${TARGET_ID}`, { method: 'DELETE' }),
      { params: Promise.resolve({ id: TARGET_ID }) },
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ deleted: true });
    expect(mocks.adminDeleteTarget).toHaveBeenCalledWith(TARGET_ID);
    expect(db.deleteTarget).not.toHaveBeenCalled();
  });

  it('rejects deleting a repo target', async () => {
    db.getTargetById.mockResolvedValue({
      id: TARGET_ID,
      organization_id: 'org-1',
      kind: 'repo',
      identifier: 'acme/api',
    });

    const res = await DELETE(
      new Request(`http://localhost/api/targets/${TARGET_ID}`, { method: 'DELETE' }),
      { params: Promise.resolve({ id: TARGET_ID }) },
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe('invalid_target');
    expect(mocks.adminDeleteTarget).not.toHaveBeenCalled();
  });

  it('returns 404 for another org’s target', async () => {
    db.getTargetById.mockResolvedValue({
      id: TARGET_ID,
      organization_id: 'org-other',
      kind: 'url',
      identifier: 'https://stranger.app',
    });

    const res = await DELETE(
      new Request(`http://localhost/api/targets/${TARGET_ID}`, { method: 'DELETE' }),
      { params: Promise.resolve({ id: TARGET_ID }) },
    );
    expect(res.status).toBe(404);
    expect(mocks.adminDeleteTarget).not.toHaveBeenCalled();
  });
});

describe('GET /api/targets/[id]', () => {
  const liveTarget = {
    id: TARGET_ID,
    organization_id: 'org-1',
    kind: 'url',
    identifier: 'https://assurly-live-target.vercel.app',
    display_name: null,
    ownership_verified: true,
    current_verdict: 'blocked',
    current_ship_score: 59,
    last_checked_at: '2026-10-23T06:34:55.908Z',
    verdict_evidence: {
      blockerSnapshot: [
        {
          rule_id: 'runtime-supabase-rls-open',
          file_path: 'Supabase REST API · customers',
          severity: 'error',
          message: "Supabase table 'customers' returned rows via anon key without RLS protection.",
        },
      ],
    },
  };

  function get() {
    return GET(new Request(`http://localhost/api/targets/${TARGET_ID}`), {
      params: Promise.resolve({ id: TARGET_ID }),
    });
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireUser.mockResolvedValue({ user: { id: 'user-1' }, accessToken: 'token', db });
    db.getOrganizationByUserId.mockResolvedValue({ id: 'org-1' });
    db.getLatestProbeEvidenceForTarget.mockResolvedValue([
      {
        id: 'e1',
        organization_id: 'org-1',
        target_id: TARGET_ID,
        scan_id: null,
        finding_rule_id: 'runtime-supabase-rls-open',
        kind: 'rls_rows',
        summary: 'We read 3 rows from your `customers` table using only the public key.',
        redacted_sample: {
          table: 'customers',
          columns: ['id', 'name', 'email', 'note'],
          rowCount: 3,
          sampleCell: '7***',
          rawRow: { email: 'never@shown.example' },
        },
        created_at: '2026-10-23T06:34:55.501Z',
      },
    ]);
    db.getFixOutcomesForTarget.mockResolvedValue([
      {
        finding_rule_id: 'runtime-supabase-rls-open',
        outcome: 'still_open',
        created_at: '2026-09-20T16:50:16.547Z',
      },
    ]);
    db.getLiveLockSummary.mockResolvedValue({
      latest: {
        id: 'lock-1',
        organization_id: 'org-1',
        target_id: TARGET_ID,
        git_sha: 'abc1234',
        attempt_id: 'run.1',
        status: 'blocked',
        ship_score: 59,
        reason: 'runtime_blocker',
        created_at: '2026-10-23T07:00:00.000Z',
      },
      stoppedDeploy: true,
    });
  });

  it('returns each blocker with its redacted proof and how long it has been open', async () => {
    db.getTargetById.mockResolvedValue(liveTarget);

    const res = await get();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      verdict: 'blocked',
      shipScore: 59,
      lastCheckedAt: '2026-10-23T06:34:55.908Z',
      blockers: [
        {
          ruleId: 'runtime-supabase-rls-open',
          location: 'Supabase REST API · customers',
          evidence: {
            kind: 'rls_rows',
            redactedSample: { table: 'customers', rowCount: 3, sampleCell: '7***' },
            checkedAt: '2026-10-23T06:34:55.501Z',
          },
          outcome: {
            status: 'still_open',
            since: '2026-09-20T16:50:16.547Z',
            foundAt: '2026-09-20T16:50:16.547Z',
          },
        },
      ],
    });
    // Only the whitelisted, already-redacted fields leave the server.
    expect(JSON.stringify(body)).not.toContain('never@shown.example');
  });

  it('returns 404 for another org’s target without reading its evidence', async () => {
    db.getTargetById.mockResolvedValue({ ...liveTarget, organization_id: 'org-other' });

    expect((await get()).status).toBe(404);
    expect(db.getLatestProbeEvidenceForTarget).not.toHaveBeenCalled();
  });

  it('returns 404 for a repository target', async () => {
    db.getTargetById.mockResolvedValue({ ...liveTarget, kind: 'repo' });
    expect((await get()).status).toBe(404);
  });
});
