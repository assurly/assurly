import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthenticationError } from '../../../../../utils/auth';
import { resetRateLimitsForTests } from '../../../../../utils/rateLimit';
import type { CanaryTokenRow, Target } from '../../../../../utils/dbAdapter';
import { ASSURLY_CANARY_PREFIX } from '@assurly/scanner-core';
import { GET, POST } from './route';

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  generateCanaryToken: vi.fn(),
  getApplicationUrl: vi.fn(() => 'https://assurly.dev'),
}));

vi.mock('../../../../../utils/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../../utils/auth')>()),
  requireUser: mocks.requireUser,
}));

vi.mock('../../../../../utils/canaryTokens', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../../utils/canaryTokens')>();
  return {
    ...actual,
    generateCanaryToken: mocks.generateCanaryToken,
  };
});

vi.mock('../../../../../utils/env', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../../utils/env')>()),
  getApplicationUrl: () => mocks.getApplicationUrl(),
}));

const TARGET_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TOKEN_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const PLAINTEXT = `${ASSURLY_CANARY_PREFIX}${'a'.repeat(32)}`;

const db = {
  getTargetById: vi.fn(),
  listCanaryTokens: vi.fn(),
  createCanaryToken: vi.fn(),
};

function ownedTarget(overrides: Partial<Target> = {}): Target {
  return {
    id: TARGET_ID,
    organization_id: 'org-1',
    kind: 'repo',
    identifier: 'acme/app',
    display_name: 'App',
    repository_id: 'repo-1',
    generator_fingerprint: null,
    ownership_verified: true,
    ownership_method: null,
    current_verdict: 'ready',
    current_ship_score: 90,
    verdict_evidence: {},
    last_checked_at: null,
    badge_token: null,
    created_at: '2026-07-18T00:00:00.000Z',
    updated_at: '2026-07-18T00:00:00.000Z',
    ...overrides,
  };
}

function tokenRow(overrides: Partial<CanaryTokenRow> = {}): CanaryTokenRow {
  return {
    id: TOKEN_ID,
    organization_id: 'org-1',
    target_id: TARGET_ID,
    token_prefix: `${ASSURLY_CANARY_PREFIX}bbbbbb`,
    label: 'Staging decoy',
    last_hit_at: null,
    hit_count: 0,
    revoked_at: null,
    created_at: '2026-07-18T00:00:00.000Z',
    ...overrides,
  };
}

function routeContext(id: string = TARGET_ID): { params: Promise<{ id: string }> } {
  return { params: Promise.resolve({ id }) };
}

describe('GET /api/targets/[id]/canary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetRateLimitsForTests();
    mocks.requireUser.mockResolvedValue({
      user: { id: 'user-1', name: 'User', email: 'u@example.com', avatar_url: '' },
      accessToken: 'verified',
      db,
    });
    db.getTargetById.mockResolvedValue(ownedTarget());
    db.listCanaryTokens.mockResolvedValue([tokenRow()]);
  });

  it('returns 401 when unauthenticated', async () => {
    mocks.requireUser.mockRejectedValue(new AuthenticationError());
    const res = await GET(
      new Request(`http://localhost/api/targets/${TARGET_ID}/canary`),
      routeContext(),
    );
    expect(res.status).toBe(401);
    expect(db.listCanaryTokens).not.toHaveBeenCalled();
  });

  it('never includes the plaintext token in the list response', async () => {
    const res = await GET(
      new Request(`http://localhost/api/targets/${TARGET_ID}/canary`),
      routeContext(),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.tokens).toHaveLength(1);
    expect(body.tokens[0]).not.toHaveProperty('token');
    expect(JSON.stringify(body)).not.toContain(PLAINTEXT);
    expect(body.tokens[0].tokenPrefix).toBe(`${ASSURLY_CANARY_PREFIX}bbbbbb`);
    expect(body.tokens[0].revokedAt).toBeNull();
  });

  it('rejects an unverified url target', async () => {
    db.getTargetById.mockResolvedValue(
      ownedTarget({ kind: 'url', ownership_verified: false, identifier: 'https://app.example' }),
    );
    const res = await GET(
      new Request(`http://localhost/api/targets/${TARGET_ID}/canary`),
      routeContext(),
    );
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe('ownership_required');
    expect(db.listCanaryTokens).not.toHaveBeenCalled();
  });
});

describe('POST /api/targets/[id]/canary (issue)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetRateLimitsForTests();
    mocks.requireUser.mockResolvedValue({
      user: { id: 'user-1', name: 'User', email: 'u@example.com', avatar_url: '' },
      accessToken: 'verified',
      db,
    });
    db.getTargetById.mockResolvedValue(ownedTarget());
    db.createCanaryToken.mockResolvedValue(tokenRow());
    mocks.getApplicationUrl.mockReturnValue('https://assurly.dev');
    mocks.generateCanaryToken.mockReturnValue({
      plaintext: PLAINTEXT,
      tokenHash: 'hash-once',
      tokenPrefix: `${ASSURLY_CANARY_PREFIX}bbbbbb`,
    });
  });

  it('returns the plaintext exactly once in the issue response', async () => {
    const res = await POST(
      new Request(`http://localhost/api/targets/${TARGET_ID}/canary`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: 'Staging decoy' }),
      }),
      routeContext(),
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.token).toBe(PLAINTEXT);
    expect(body.tokenPrefix).toBe(`${ASSURLY_CANARY_PREFIX}bbbbbb`);
    expect(body.callbackUrl).toBe(
      `https://assurly.dev/api/canary/${encodeURIComponent(PLAINTEXT)}`,
    );
    expect(body.snippet).toContain('ASSURLY_CANARY_URL=');
    expect(body.snippet).toContain(body.callbackUrl);
    expect(body.snippet).not.toContain('NEXT_PUBLIC_SUPABASE_URL=');
    expect(body.snippet).not.toContain('STRIPE_SECRET_KEY=');
    expect(body.snippet).not.toContain('DATABASE_URL=');
    expect(body.mcpSnippet).toContain('assurly-cloud-auth');
    expect(body.mcpSnippet).toContain(body.callbackUrl);
    expect(db.createCanaryToken).toHaveBeenCalledWith(
      expect.objectContaining({
        tokenHash: 'hash-once',
        tokenPrefix: `${ASSURLY_CANARY_PREFIX}bbbbbb`,
        label: 'Staging decoy',
      }),
    );
    // Persisted row must never carry the plaintext.
    const persistedArg = db.createCanaryToken.mock.calls[0]![0] as Record<string, unknown>;
    expect(persistedArg).not.toHaveProperty('token');
    expect(JSON.stringify(persistedArg)).not.toContain(PLAINTEXT);
  });

  it('plants the public Assurly origin even when issued from localhost', async () => {
    mocks.getApplicationUrl.mockReturnValue('http://localhost:3000');
    const res = await POST(
      new Request(`http://localhost/api/targets/${TARGET_ID}/canary`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: 'Silent alarm' }),
      }),
      routeContext(),
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.callbackUrl).toBe(
      `https://assurly.dev/api/canary/${encodeURIComponent(PLAINTEXT)}`,
    );
    expect(body.snippet).toContain('https://assurly.dev/api/canary/');
    expect(body.snippet).not.toContain('localhost');
  });
});
