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

import { DELETE } from './route';

const TARGET_ID = '11111111-1111-4111-8111-111111111111';

const db = {
  getOrganizationByUserId: vi.fn(),
  getTargetById: vi.fn(),
  deleteTarget: vi.fn(),
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
