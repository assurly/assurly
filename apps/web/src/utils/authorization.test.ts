import { describe, expect, it, vi } from 'vitest';
import type { AuthContext } from './auth';
import { AuthorizationError, requireRepositoryAccess } from './authorization';

function context(overrides: Record<string, unknown> = {}): AuthContext {
  return {
    user: { id: 'user-a', name: 'A', email: '', avatar_url: '' },
    accessToken: 'verified',
    db: {
      getRepository: vi.fn().mockResolvedValue({
        id: 'repo-b',
        organization_id: 'org-b',
      }),
      getOrganization: vi.fn().mockResolvedValue({ id: 'org-b' }),
      getMembership: vi.fn().mockResolvedValue(null),
      ...overrides,
    } as unknown as AuthContext['db'],
  };
}

describe('tenant authorization', () => {
  it('denies a known repository UUID from another organization', async () => {
    await expect(requireRepositoryAccess(context(), 'repo-b')).rejects.toBeInstanceOf(
      AuthorizationError,
    );
  });

  it('allows a repository only when the authenticated user is a member', async () => {
    const membership = {
      id: 'membership-a',
      user_id: 'user-a',
      organization_id: 'org-b',
      role: 'member' as const,
      created_at: '',
    };
    const result = await requireRepositoryAccess(
      context({ getMembership: vi.fn().mockResolvedValue(membership) }),
      'repo-b',
    );
    expect(result.membership).toEqual(membership);
  });
});
