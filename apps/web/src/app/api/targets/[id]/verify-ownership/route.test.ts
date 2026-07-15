import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthenticationError } from '../../../../../utils/auth';
import { resetRateLimitsForTests } from '../../../../../utils/rateLimit';
import { GET, POST } from './route';

const requireUserMock = vi.hoisted(() => vi.fn());
const verifyOwnershipMock = vi.hoisted(() => vi.fn());

vi.mock('../../../../../utils/auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../../utils/auth')>();
  return { ...actual, requireUser: requireUserMock };
});

vi.mock('../../../../../utils/ownership', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../../utils/ownership')>();
  return { ...actual, verifyOwnership: verifyOwnershipMock };
});

const TARGET_ID = '11111111-1111-1111-1111-111111111111';

function urlTarget(overrides: Record<string, unknown> = {}) {
  return {
    id: TARGET_ID,
    organization_id: 'org-1',
    kind: 'url',
    identifier: 'https://app.example',
    ownership_verified: false,
    ownership_method: null,
    ...overrides,
  };
}

function params() {
  return { params: Promise.resolve({ id: TARGET_ID }) };
}

describe('/api/targets/[id]/verify-ownership', () => {
  beforeEach(() => {
    resetRateLimitsForTests();
    requireUserMock.mockReset();
    verifyOwnershipMock.mockReset();
  });

  it('GET issues a challenge token for a url target the caller owns', async () => {
    const getTargetById = vi.fn().mockResolvedValue(urlTarget());
    requireUserMock.mockResolvedValue({
      user: { id: 'user-1' },
      accessToken: 'token',
      db: { getTargetById },
    });

    const response = await GET(
      new Request(`http://localhost/api/targets/${TARGET_ID}/verify-ownership`),
      params(),
    );

    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.verified).toBe(false);
    expect(json.identifier).toBe('https://app.example');
    expect(json.challenge.token).toMatch(/^av_[0-9a-f]{40}$/);
    expect(json.challenge.metaTag).toContain('assurly-verify');
    expect(json.challenge.dnsRecord).toContain('assurly-verify=');
  });

  it('POST sets ownership_verified when the challenge passes', async () => {
    const getTargetById = vi.fn().mockResolvedValue(urlTarget());
    const setTargetOwnership = vi
      .fn()
      .mockResolvedValue(urlTarget({ ownership_verified: true, ownership_method: 'meta_tag' }));
    requireUserMock.mockResolvedValue({
      user: { id: 'user-1' },
      accessToken: 'token',
      db: { getTargetById, setTargetOwnership },
    });
    verifyOwnershipMock.mockResolvedValue(true);

    const response = await POST(
      new Request(`http://localhost/api/targets/${TARGET_ID}/verify-ownership`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method: 'meta_tag' }),
      }),
      params(),
    );

    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.verified).toBe(true);
    expect(setTargetOwnership).toHaveBeenCalledWith(TARGET_ID, {
      ownershipVerified: true,
      ownershipMethod: 'meta_tag',
    });
  });

  it('POST does NOT set ownership when the challenge fails', async () => {
    const getTargetById = vi.fn().mockResolvedValue(urlTarget());
    const setTargetOwnership = vi.fn();
    requireUserMock.mockResolvedValue({
      user: { id: 'user-1' },
      accessToken: 'token',
      db: { getTargetById, setTargetOwnership },
    });
    verifyOwnershipMock.mockResolvedValue(false);

    const response = await POST(
      new Request(`http://localhost/api/targets/${TARGET_ID}/verify-ownership`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method: 'dns_txt' }),
      }),
      params(),
    );

    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.verified).toBe(false);
    expect(setTargetOwnership).not.toHaveBeenCalled();
  });

  it('rejects a non-url target with 400', async () => {
    const getTargetById = vi.fn().mockResolvedValue(urlTarget({ kind: 'repo' }));
    requireUserMock.mockResolvedValue({
      user: { id: 'user-1' },
      accessToken: 'token',
      db: { getTargetById, setTargetOwnership: vi.fn() },
    });
    verifyOwnershipMock.mockResolvedValue(true);

    const response = await POST(
      new Request(`http://localhost/api/targets/${TARGET_ID}/verify-ownership`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method: 'meta_tag' }),
      }),
      params(),
    );

    expect(response.status).toBe(400);
    expect(verifyOwnershipMock).not.toHaveBeenCalled();
  });

  it('returns 404 when the target does not exist / is not the caller org', async () => {
    const getTargetById = vi.fn().mockResolvedValue(null);
    requireUserMock.mockResolvedValue({
      user: { id: 'user-1' },
      accessToken: 'token',
      db: { getTargetById, setTargetOwnership: vi.fn() },
    });

    const response = await POST(
      new Request(`http://localhost/api/targets/${TARGET_ID}/verify-ownership`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method: 'meta_tag' }),
      }),
      params(),
    );

    expect(response.status).toBe(404);
  });

  it('requires authentication', async () => {
    requireUserMock.mockRejectedValue(new AuthenticationError());

    const response = await POST(
      new Request(`http://localhost/api/targets/${TARGET_ID}/verify-ownership`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method: 'meta_tag' }),
      }),
      params(),
    );

    expect(response.status).toBe(401);
  });
});
