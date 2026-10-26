import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ requireUser: vi.fn() }));
vi.mock('../../../utils/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../utils/auth')>()),
  requireUser: mocks.requireUser,
}));

import { GET } from './route';
import { POST } from './active/route';
import { AuthenticationError } from '../../../utils/auth';
import { resetRateLimitsForTests } from '../../../utils/rateLimit';

const ORG_A = '11111111-1111-4111-8111-111111111111';
const ORG_B = '22222222-2222-4222-8222-222222222222';
const db = { listOrganizationsForUser: vi.fn(), selectOrganization: vi.fn() };

function select(organizationId: unknown, headers: Record<string, string> = {}) {
  return POST(
    new Request('http://localhost/api/organizations/active', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify({ organizationId }),
    }),
  );
}

describe('workspace switching', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetRateLimitsForTests();
    mocks.requireUser.mockResolvedValue({ user: { id: 'user-1' }, accessToken: 'token', db });
  });

  it('lists the caller’s workspaces with the active one first', async () => {
    db.listOrganizationsForUser.mockResolvedValue([
      { id: ORG_B, name: 'Acme (Vercel)', billing_plan: 'free', role: 'admin' },
      { id: ORG_A, name: 'Personal', billing_plan: 'pro', role: 'admin' },
    ]);
    const res = await GET(new Request('http://localhost/api/organizations'));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ activeId: ORG_B });
    expect(db.listOrganizationsForUser).toHaveBeenCalledWith('user-1');
  });

  it('requires a session', async () => {
    mocks.requireUser.mockRejectedValue(new AuthenticationError());
    expect((await GET(new Request('http://localhost/api/organizations'))).status).toBe(401);
    expect((await select(ORG_A)).status).toBe(401);
  });

  it('switches to one of the caller’s own workspaces', async () => {
    db.selectOrganization.mockResolvedValue(true);
    const res = await select(ORG_A);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ activeId: ORG_A });
    expect(db.selectOrganization).toHaveBeenCalledWith(ORG_A);
  });

  it('answers 404 for a workspace the caller does not belong to', async () => {
    db.selectOrganization.mockResolvedValue(false);
    expect((await select(ORG_B)).status).toBe(404);
  });

  it('rejects a malformed id before touching the database', async () => {
    expect((await select('not-a-uuid')).status).toBe(400);
    expect(db.selectOrganization).not.toHaveBeenCalled();
  });
});
