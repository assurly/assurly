import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthenticationError } from '../../../../utils/auth';
import { resetRateLimitsForTests } from '../../../../utils/rateLimit';
import { DEP_NONEXISTENT_PACKAGE, DEP_REGISTRY_UNAVAILABLE } from '@assurly/scanner-core';

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  getAdminDbAdapter: vi.fn(),
  evaluateNamedDependencies: vi.fn(),
}));

vi.mock('../../../../utils/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../utils/auth')>()),
  requireUser: mocks.requireUser,
}));

vi.mock('../../../../utils/dbAdapter', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../utils/dbAdapter')>()),
  getAdminDbAdapter: mocks.getAdminDbAdapter,
}));

vi.mock('../../../../utils/dependencyProvenanceLookup', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../../../utils/dependencyProvenanceLookup')>();
  return {
    ...actual,
    evaluateNamedDependencies: mocks.evaluateNamedDependencies,
    createDbNpmCacheStore: vi.fn(() => ({ get: vi.fn(), upsert: vi.fn() })),
  };
});

import { POST } from './route';

describe('POST /api/dependencies/provenance', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetRateLimitsForTests();
    mocks.requireUser.mockResolvedValue({
      user: { id: 'user-1', name: 'User', email: 'u@example.com', avatar_url: '' },
      accessToken: 'verified',
      db: {},
    });
    mocks.getAdminDbAdapter.mockReturnValue({
      getNpmPackageCache: vi.fn(),
      upsertNpmPackageCache: vi.fn(),
    });
    mocks.evaluateNamedDependencies.mockResolvedValue({
      evaluatedDependencies: ['never-published-pkg-xyz'],
      findings: [
        {
          ruleId: DEP_NONEXISTENT_PACKAGE,
          severity: 'error',
          confidence: 'high',
          file: 'package.json',
          message: "Dependency 'never-published-pkg-xyz' does not exist on npm.",
          suggestion: 'Remove or replace it.',
        },
      ],
    });
  });

  it('returns 401 when unauthenticated', async () => {
    mocks.requireUser.mockRejectedValue(new AuthenticationError());
    const res = await POST(
      new Request('http://localhost/api/dependencies/provenance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ packages: ['lodash'] }),
      }),
    );
    expect(res.status).toBe(401);
    expect(mocks.evaluateNamedDependencies).not.toHaveBeenCalled();
  });

  it('returns provenance findings for package names', async () => {
    const res = await POST(
      new Request('http://localhost/api/dependencies/provenance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ packages: ['never-published-pkg-xyz'] }),
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.findings[0].ruleId).toBe(DEP_NONEXISTENT_PACKAGE);
    expect(mocks.evaluateNamedDependencies).toHaveBeenCalledWith(
      expect.objectContaining({
        packageNames: ['never-published-pkg-xyz'],
      }),
    );
  });

  it('surfaces registry-unavailable findings without failing the route', async () => {
    mocks.evaluateNamedDependencies.mockResolvedValue({
      evaluatedDependencies: ['pkg'],
      findings: [
        {
          ruleId: DEP_REGISTRY_UNAVAILABLE,
          severity: 'warning',
          confidence: 'medium',
          file: 'package.json',
          message: 'Registry unavailable for pkg.',
          suggestion: 'Retry later.',
        },
      ],
    });
    const res = await POST(
      new Request('http://localhost/api/dependencies/provenance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ packages: ['pkg'] }),
      }),
    );
    expect(res.status).toBe(200);
    expect((await res.json()).findings[0].ruleId).toBe(DEP_REGISTRY_UNAVAILABLE);
  });
});
