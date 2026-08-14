import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ requireUser: vi.fn() }));
vi.mock('../../../../utils/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../utils/auth')>()),
  requireUser: mocks.requireUser,
}));

vi.mock('../../../../utils/authorization', () => ({
  requireRepositoryAccess: vi.fn().mockResolvedValue(undefined),
}));

import { DELETE, PATCH } from './route';

const db = {
  updateRepositoryScanCapability: vi.fn(),
  deleteRepository: vi.fn(),
  getRepository: vi.fn(),
};

describe('/api/repositories/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireUser.mockResolvedValue({
      user: { id: 'user-1', name: 'User', email: 'user@example.com', avatar_url: '' },
      accessToken: 'verified',
      db,
    });
    db.getRepository.mockResolvedValue({
      id: '00000000-0000-4000-8000-000000000001',
      organization_id: 'org-1',
      name: 'acme/app',
      github_repo_id: 1,
      is_active: true,
      created_at: '2026-01-01T00:00:00.000Z',
      scan_capability: 'cli_only',
    });
  });

  it('PATCH persists scan_capability', async () => {
    const response = await PATCH(
      new Request('http://localhost/api/repositories/00000000-0000-4000-8000-000000000001', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scanCapability: 'cli_only' }),
      }),
      { params: Promise.resolve({ id: '00000000-0000-4000-8000-000000000001' }) },
    );

    expect(response.status).toBe(200);
    expect(db.updateRepositoryScanCapability).toHaveBeenCalledWith(
      '00000000-0000-4000-8000-000000000001',
      'cli_only',
    );
  });

  it('DELETE removes the repository', async () => {
    const response = await DELETE(
      new Request('http://localhost/api/repositories/00000000-0000-4000-8000-000000000001', {
        method: 'DELETE',
      }),
      { params: Promise.resolve({ id: '00000000-0000-4000-8000-000000000001' }) },
    );

    expect(response.status).toBe(200);
    expect(db.deleteRepository).toHaveBeenCalledWith('00000000-0000-4000-8000-000000000001');
  });
});
