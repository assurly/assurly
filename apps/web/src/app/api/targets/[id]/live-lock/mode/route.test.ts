import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  requireMember: vi.fn(),
  revoke: vi.fn(),
  admin: {
    getLiveLockBypass: vi.fn(),
    getVercelConnection: vi.fn(),
    deleteLiveLockBypass: vi.fn(),
    deleteLiveLockProject: vi.fn(),
    setLiveLockMode: vi.fn(),
  },
}));
vi.mock('../../../../../../utils/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../../../utils/auth')>()),
  requireUser: mocks.requireUser,
}));
vi.mock('../../../../../../utils/authorization', () => ({
  requireOrganizationMember: mocks.requireMember,
}));
vi.mock('../../../../../../utils/dbAdapter', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../../../utils/dbAdapter')>()),
  getAdminDbAdapter: () => mocks.admin,
}));
vi.mock('../../../../../../utils/vercelToken', () => ({
  decryptVercelToken: (value: string) => `plain:${value}`,
}));
vi.mock('../../../../../../utils/vercelIntegration', () => ({
  createVercelIntegrationApi: () => ({ revokeProtectionBypass: mocks.revoke }),
}));

import { POST } from './route';
import { resetRateLimitsForTests } from '../../../../../../utils/rateLimit';

const TARGET_ID = '11111111-1111-4111-8111-111111111111';
const db = { getOrganizationByUserId: vi.fn(), getTargetById: vi.fn() };

function post(mode: string): Promise<Response> {
  return POST(
    new Request(`http://localhost/api/targets/${TARGET_ID}/live-lock/mode`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mode }),
    }),
    { params: Promise.resolve({ id: TARGET_ID }) },
  );
}

describe('POST /api/targets/[id]/live-lock/mode', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetRateLimitsForTests();
    mocks.requireUser.mockResolvedValue({ user: { id: 'user-1' }, accessToken: 'token', db });
    mocks.requireMember.mockResolvedValue(undefined);
    db.getOrganizationByUserId.mockResolvedValue({ id: 'org-1' });
    db.getTargetById.mockResolvedValue({ id: TARGET_ID, organization_id: 'org-1', kind: 'url' });
    mocks.admin.getVercelConnection.mockResolvedValue({
      team_id: 'team_1',
      configuration_id: 'icfg_1',
      token_ciphertext: 'tok',
    });
  });

  it('turning off revokes the bypass in Vercel and drops the stored copy', async () => {
    mocks.admin.getLiveLockBypass.mockResolvedValue({
      vercel_project_id: 'prj_app',
      secret_ciphertext: 'sec',
    });
    const res = await post('off');
    expect(res.status).toBe(200);
    expect(mocks.revoke).toHaveBeenCalledWith('prj_app', 'plain:sec');
    expect(mocks.admin.deleteLiveLockBypass).toHaveBeenCalledWith(TARGET_ID);
    expect(mocks.admin.deleteLiveLockProject).toHaveBeenCalledWith(TARGET_ID);
  });

  it('still turns off when Vercel will not revoke', async () => {
    mocks.admin.getLiveLockBypass.mockResolvedValue({
      vercel_project_id: 'prj_app',
      secret_ciphertext: 'sec',
    });
    mocks.revoke.mockRejectedValueOnce(new Error('403'));
    expect((await post('off')).status).toBe(200);
    expect(mocks.admin.deleteLiveLockBypass).toHaveBeenCalledWith(TARGET_ID);
    expect(mocks.admin.deleteLiveLockProject).toHaveBeenCalledWith(TARGET_ID);
  });

  it('does not touch Vercel when there is no bypass', async () => {
    mocks.admin.getLiveLockBypass.mockResolvedValue(null);
    expect((await post('off')).status).toBe(200);
    expect(mocks.revoke).not.toHaveBeenCalled();
    expect(mocks.admin.deleteLiveLockProject).toHaveBeenCalledWith(TARGET_ID);
  });

  it('switching modes keeps the bypass', async () => {
    mocks.admin.setLiveLockMode.mockResolvedValue({ mode: 'enforce' });
    expect(await (await post('enforce')).json()).toEqual({ mode: 'enforce' });
    expect(mocks.admin.getLiveLockBypass).not.toHaveBeenCalled();
  });
});
