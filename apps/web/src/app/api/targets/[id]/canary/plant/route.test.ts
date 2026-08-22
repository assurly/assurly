import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthenticationError } from '../../../../../../utils/auth';
import { resetRateLimitsForTests } from '../../../../../../utils/rateLimit';
import type { CanaryTokenRow, Target } from '../../../../../../utils/dbAdapter';
import { ASSURLY_CANARY_PREFIX } from '@assurly/scanner-core';
import { AutoFixAlreadyAppliedError } from '../../../../../../utils/githubApp';
import { POST } from './route';

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  generateCanaryToken: vi.fn(),
  getApplicationUrl: vi.fn(() => 'https://assurly.dev'),
  executeGitHubFixPullRequest: vi.fn(),
  resolveGitHubAccessToken: vi.fn(),
}));

vi.mock('../../../../../../utils/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../../../utils/auth')>()),
  requireUser: mocks.requireUser,
  resolveGitHubAccessToken: mocks.resolveGitHubAccessToken,
}));

vi.mock('../../../../../../utils/canaryTokens', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../../../utils/canaryTokens')>();
  return {
    ...actual,
    generateCanaryToken: mocks.generateCanaryToken,
  };
});

vi.mock('../../../../../../utils/env', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../../../utils/env')>()),
  getApplicationUrl: () => mocks.getApplicationUrl(),
}));

vi.mock('../../../../../../utils/githubFixPipeline', () => ({
  executeGitHubFixPullRequest: mocks.executeGitHubFixPullRequest,
}));

const TARGET_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TOKEN_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const REPO_ID = '11000000-0000-4000-8000-000000000001';
const PLAINTEXT = `${ASSURLY_CANARY_PREFIX}${'a'.repeat(32)}`;

const db = {
  getTargetById: vi.fn(),
  getRepository: vi.fn(),
  getOrganization: vi.fn(),
  createCanaryToken: vi.fn(),
};

function ownedTarget(overrides: Partial<Target> = {}): Target {
  return {
    id: TARGET_ID,
    organization_id: 'org-1',
    kind: 'repo',
    identifier: 'acme/app',
    display_name: 'App',
    repository_id: REPO_ID,
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
    label: 'Silent alarm',
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

function plantRequest(): Request {
  return new Request(`http://localhost/api/targets/${TARGET_ID}/canary/plant`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
}

describe('POST /api/targets/[id]/canary/plant', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetRateLimitsForTests();
    mocks.requireUser.mockResolvedValue({
      user: { id: 'user-1', name: 'User', email: 'u@example.com', avatar_url: '' },
      accessToken: 'verified',
      githubAccessToken: 'gho_test',
      db,
    });
    db.getTargetById.mockResolvedValue(ownedTarget());
    db.getRepository.mockResolvedValue({
      id: REPO_ID,
      organization_id: 'org-1',
      name: 'acme/app',
      github_repo_id: 123,
      is_active: true,
      created_at: '2026-01-01T00:00:00.000Z',
    });
    db.getOrganization.mockResolvedValue({ id: 'org-1', github_installation_id: '140302856' });
    db.createCanaryToken.mockResolvedValue(tokenRow());
    mocks.getApplicationUrl.mockReturnValue('http://localhost:3000');
    mocks.generateCanaryToken.mockReturnValue({
      plaintext: PLAINTEXT,
      tokenHash: 'hash-once',
      tokenPrefix: `${ASSURLY_CANARY_PREFIX}bbbbbb`,
    });
    mocks.executeGitHubFixPullRequest.mockResolvedValue('https://github.com/acme/app/pull/42');
  });

  it('returns 401 when unauthenticated', async () => {
    mocks.requireUser.mockRejectedValue(new AuthenticationError());
    const res = await POST(plantRequest(), routeContext());
    expect(res.status).toBe(401);
    expect(mocks.executeGitHubFixPullRequest).not.toHaveBeenCalled();
  });

  it('opens a plant PR with the public origin snippet and never commits to main', async () => {
    const res = await POST(plantRequest(), routeContext());
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.prUrl).toBe('https://github.com/acme/app/pull/42');
    expect(body.alreadyPlanted).toBe(false);
    expect(body.callbackUrl).toContain('https://assurly.dev/api/canary/');
    expect(body.snippet).toContain('ASSURLY_CANARY_URL=');
    expect(body.snippet).not.toContain('localhost');
    expect(body.mcpSnippet).toContain('assurly-cloud-auth');
    expect(mocks.executeGitHubFixPullRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        repositoryName: 'acme/app',
        baseBranch: 'main',
        filePath: '.env.example',
        branchSeed: `canary-plant:${TARGET_ID}`,
        fix: expect.objectContaining({
          targetFilePath: '.env.example',
          applyMode: 'upsert-env',
          title: 'Plant Assurly silent alarm',
        }),
      }),
    );
    const statement = mocks.executeGitHubFixPullRequest.mock.calls[0]![0].fix.statement as string;
    expect(statement).toContain('ASSURLY_CANARY_URL=https://assurly.dev/api/canary/');
    expect(statement).not.toContain('localhost');
  });

  it('is idempotent when the env key is already planted', async () => {
    mocks.executeGitHubFixPullRequest.mockRejectedValue(new AutoFixAlreadyAppliedError());
    const res = await POST(plantRequest(), routeContext());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.alreadyPlanted).toBe(true);
    expect(body.prUrl).toBeNull();
    expect(db.createCanaryToken).not.toHaveBeenCalled();
  });

  it('rejects an unverified url target', async () => {
    db.getTargetById.mockResolvedValue(
      ownedTarget({
        kind: 'url',
        ownership_verified: false,
        identifier: 'https://app.example',
        repository_id: null,
      }),
    );
    const res = await POST(plantRequest(), routeContext());
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe('ownership_required');
    expect(mocks.executeGitHubFixPullRequest).not.toHaveBeenCalled();
  });
});
