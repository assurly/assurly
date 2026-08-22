import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  authenticateApiKey: vi.fn(),
  generateCanaryToken: vi.fn(),
  getApplicationUrl: vi.fn(() => 'https://assurly.dev'),
}));

vi.mock('../../../../utils/apiKeys', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../utils/apiKeys')>()),
  authenticateApiKey: mocks.authenticateApiKey,
}));

vi.mock('../../../../utils/canaryTokens', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../utils/canaryTokens')>();
  return {
    ...actual,
    generateCanaryToken: mocks.generateCanaryToken,
  };
});

vi.mock('../../../../utils/env', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../utils/env')>()),
  getApplicationUrl: () => mocks.getApplicationUrl(),
}));

const db = {
  getTargetByIdentifier: vi.fn(),
  createCanaryToken: vi.fn(),
};

vi.mock('../../../../utils/dbAdapter', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../utils/dbAdapter')>();
  return {
    ...actual,
    getAdminDbAdapter: () => db,
  };
});

import { ASSURLY_CANARY_PREFIX } from '@assurly/scanner-core';
import { resetRateLimitsForTests } from '../../../../utils/rateLimit';
import { POST } from './route';

const TARGET_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const PLAINTEXT = `${ASSURLY_CANARY_PREFIX}${'a'.repeat(32)}`;

describe('POST /api/v1/canary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetRateLimitsForTests();
    mocks.authenticateApiKey.mockResolvedValue({
      id: 'key-1',
      organizationId: 'org-1',
      plan: 'pro',
    });
    db.getTargetByIdentifier.mockResolvedValue({
      id: TARGET_ID,
      organization_id: 'org-1',
      kind: 'repo',
      identifier: 'acme/app',
      ownership_verified: true,
    });
    db.createCanaryToken.mockResolvedValue({
      id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      organization_id: 'org-1',
      target_id: TARGET_ID,
      token_prefix: `${ASSURLY_CANARY_PREFIX}bbbbbb`,
      label: 'Silent alarm',
      created_at: '2026-08-18T00:00:00.000Z',
    });
    mocks.generateCanaryToken.mockReturnValue({
      plaintext: PLAINTEXT,
      tokenHash: 'hash-once',
      tokenPrefix: `${ASSURLY_CANARY_PREFIX}bbbbbb`,
    });
  });

  it('mints a public snippet for a connected repo without uploading source', async () => {
    const response = await POST(
      new Request('http://localhost/api/v1/canary', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer assurly_test',
        },
        body: JSON.stringify({ repo: 'acme/app' }),
      }),
    );
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.snippet).toContain('ASSURLY_CANARY_URL=');
    expect(body.callbackUrl).toContain('https://assurly.dev/api/canary/');
    expect(body.mcpSnippet).toContain('assurly-cloud-auth');
    expect(db.getTargetByIdentifier).toHaveBeenCalledWith('org-1', 'repo', 'acme/app');
    expect(JSON.stringify(body)).toContain(PLAINTEXT);
  });

  it('returns 401 without an API key', async () => {
    mocks.authenticateApiKey.mockResolvedValue(null);
    const response = await POST(
      new Request('http://localhost/api/v1/canary', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repo: 'acme/app' }),
      }),
    );
    expect(response.status).toBe(401);
    expect(db.createCanaryToken).not.toHaveBeenCalled();
  });
});
