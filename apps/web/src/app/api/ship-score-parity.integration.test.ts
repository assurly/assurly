import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Target } from '../../utils/dbAdapter';
import { toPublicTrustProjection } from '../../utils/publicTrust';
import { resetRateLimitsForTests } from '../../utils/rateLimit';
import { BLOCKED_SCORE_CAP, INCOMPLETE_SCORE_CAP } from '../../utils/shipScoreDisplay';

/**
 * One stored verdict, one Ship Score everywhere. The dashboard clamps a stored
 * score for incomplete coverage and for a blocked verdict; the keyed verdict
 * API, the public trust projection and the README badge read the same
 * `targets` row and must report exactly the same number.
 *
 * Drives the REAL route handlers so the surfaces cannot drift apart again.
 */

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  authenticateApiKey: vi.fn(),
  getAdminDbAdapter: vi.fn(),
}));

vi.mock('../../utils/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../utils/auth')>()),
  requireUser: mocks.requireUser,
}));

vi.mock('../../utils/apiKeys', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../utils/apiKeys')>()),
  authenticateApiKey: mocks.authenticateApiKey,
}));

vi.mock('../../utils/dbAdapter', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../utils/dbAdapter')>()),
  getAdminDbAdapter: mocks.getAdminDbAdapter,
}));

import { GET as badgeGET } from './badge/[token]/route';
import { GET as targetsGET } from './targets/route';
import { GET as trustGET } from './trust/[token]/route';
import { GET as verdictGET } from './v1/verdict/route';

const ORG_ID = 'org-1';
const REPO_ID = 'a26e03a7-42b0-42be-b2c9-fd685ea177a0';
const BADGE_TOKEN = 'a'.repeat(32);
const CHECKED_AT = '2026-08-09T19:47:28.312Z';

interface TopIssueFixture {
  key: string;
  label: string;
  severity: 'error' | 'warning';
}

function makeTarget(fixture: {
  identifier: string;
  storedScore: number | null;
  verdict: Target['current_verdict'];
  topIssue?: TopIssueFixture;
}): Target {
  return {
    id: 'target-1',
    organization_id: ORG_ID,
    kind: 'repo',
    identifier: fixture.identifier,
    display_name: fixture.identifier,
    repository_id: REPO_ID,
    generator_fingerprint: null,
    ownership_verified: false,
    ownership_method: null,
    current_verdict: fixture.verdict,
    current_ship_score: fixture.storedScore,
    verdict_evidence: { topIssue: fixture.topIssue ?? null },
    last_checked_at: CHECKED_AT,
    badge_token: BADGE_TOKEN,
    created_at: '2026-08-01T00:00:00.000Z',
    updated_at: CHECKED_AT,
  };
}

/**
 * The dashboard card. The latest scan carries the same stored score as the
 * target row — the one fixture both surfaces resolve from.
 */
async function dashboardScore(target: Target): Promise<number | null> {
  const db = {
    getOrganizationByUserId: vi
      .fn()
      .mockResolvedValue({ id: ORG_ID, name: 'acme', billing_plan: 'pro' }),
    getRepositories: vi
      .fn()
      .mockResolvedValue([{ id: REPO_ID, organization_id: ORG_ID, name: target.identifier }]),
    getTargets: vi.fn().mockResolvedValue([target]),
    getLatestScanSummaries: vi.fn().mockResolvedValue(
      target.current_ship_score == null
        ? new Map()
        : new Map([
            [
              REPO_ID,
              {
                id: 'scan-1',
                repository_id: REPO_ID,
                ship_score: target.current_ship_score,
                verdict: target.current_verdict,
                scanned_file_count: null,
                clean_file_count: null,
                created_at: CHECKED_AT,
              },
            ],
          ]),
    ),
    getRecentScans: vi.fn().mockResolvedValue([]),
    getScanFindings: vi.fn().mockResolvedValue([]),
  };
  mocks.requireUser.mockResolvedValue({
    user: { id: 'user-1', name: 'User', email: 'user@example.com', avatar_url: '' },
    accessToken: 'verified',
    db,
  });

  const response = await targetsGET(new Request('http://localhost/api/targets'));
  expect(response.status).toBe(200);
  const body = (await response.json()) as { targets: Array<{ shipScore: number | null }> };
  return body.targets[0].shipScore;
}

/** The keyed verdict API — the number the MCP `assurly_verdict` tool relays. */
async function verdictApiScore(target: Target): Promise<number | null> {
  mocks.authenticateApiKey.mockResolvedValue({
    id: 'key-1',
    organizationId: ORG_ID,
    plan: 'pro',
  });
  mocks.getAdminDbAdapter.mockReturnValue({
    getTargetByIdentifier: vi.fn().mockResolvedValue(target),
    getFixOutcomesForTarget: vi.fn().mockResolvedValue([]),
  });

  const response = await verdictGET(
    new Request(`http://localhost/api/v1/verdict?repo=${encodeURIComponent(target.identifier)}`, {
      headers: { authorization: 'Bearer ask_live_dummy' },
    }),
  );
  expect(response.status).toBe(200);
  return ((await response.json()) as { shipScore: number | null }).shipScore;
}

/** The public trust projection — shared by `/api/trust/[token]` and `/report/[token]`. */
async function trustScore(target: Target): Promise<number | null> {
  mocks.getAdminDbAdapter.mockReturnValue({
    getTargetByBadgeToken: vi.fn().mockResolvedValue(target),
  });

  const response = await trustGET(new Request(`http://localhost/api/trust/${BADGE_TOKEN}`), {
    params: Promise.resolve({ token: BADGE_TOKEN }),
  });
  expect(response.status).toBe(200);
  return ((await response.json()) as { shipScore: number | null }).shipScore;
}

async function badgeSvg(target: Target): Promise<string> {
  mocks.getAdminDbAdapter.mockReturnValue({
    getTargetByBadgeToken: vi.fn().mockResolvedValue(target),
    getScanByShareToken: vi.fn().mockResolvedValue(null),
    getScanFindings: vi.fn().mockResolvedValue([]),
  });

  const response = await badgeGET(new Request(`http://localhost/api/badge/${BADGE_TOKEN}`), {
    params: Promise.resolve({ token: BADGE_TOKEN }),
  });
  expect(response.status).toBe(200);
  return response.text();
}

describe('Ship Score parity across every user-visible surface', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetRateLimitsForTests();
  });

  it('reports one number for a blocked target stored above the blocked cap', async () => {
    const target = makeTarget({
      identifier: 'acme/blocked-app',
      storedScore: 88,
      verdict: 'blocked',
      topIssue: {
        key: 'rls:customers',
        label: 'Missing RLS on table: customers',
        severity: 'error',
      },
    });

    const dashboard = await dashboardScore(target);
    expect(await verdictApiScore(target)).toBe(dashboard);
    expect(await trustScore(target)).toBe(dashboard);
    expect(toPublicTrustProjection(target)?.shipScore).toBe(dashboard);
    expect(await badgeSvg(target)).toContain(`Ship Score ${dashboard}/100`);

    // The cap only ever lowers a stored score — it never invents a better one.
    expect(dashboard).toBe(BLOCKED_SCORE_CAP);
    expect(dashboard).toBeLessThan(88);
  });

  it('reports one number for a blocked target already below the blocked cap', async () => {
    const target = makeTarget({
      identifier: 'tibco87/PHPAuth',
      storedScore: 36,
      verdict: 'blocked',
      topIssue: {
        key: 'rls:users',
        label: 'Missing RLS on table: users',
        severity: 'error',
      },
    });

    const dashboard = await dashboardScore(target);
    expect(await verdictApiScore(target)).toBe(dashboard);
    expect(await trustScore(target)).toBe(dashboard);
    expect(await badgeSvg(target)).toContain(`Ship Score ${dashboard}/100`);
    expect(dashboard).toBe(36);
  });

  it('reports one number for an incomplete-coverage target stored above the coverage cap', async () => {
    const target = makeTarget({
      identifier: 'tibco87/ShipReady',
      storedScore: 96,
      verdict: 'review',
      topIssue: {
        key: 'rule:scan-completeness',
        label: 'Scan is incomplete',
        severity: 'warning',
      },
    });

    const dashboard = await dashboardScore(target);
    expect(await verdictApiScore(target)).toBe(dashboard);
    expect(await trustScore(target)).toBe(dashboard);
    expect(toPublicTrustProjection(target)?.shipScore).toBe(dashboard);
    expect(await badgeSvg(target)).toContain(`Ship Score ${dashboard}/100`);

    expect(dashboard).toBe(INCOMPLETE_SCORE_CAP);
    expect(dashboard).toBeLessThan(96);
  });

  it('reports null on every surface when no score is stored, and never fabricates one', async () => {
    const target = makeTarget({
      identifier: 'acme/never-scanned',
      storedScore: null,
      verdict: null,
    });

    expect(await dashboardScore(target)).toBeNull();
    expect(await verdictApiScore(target)).toBeNull();
    expect(await trustScore(target)).toBeNull();
    expect(toPublicTrustProjection(target)?.shipScore).toBeNull();

    const svg = await badgeSvg(target);
    expect(svg).toContain('Ship Score unavailable');
    expect(svg).not.toMatch(/Ship Score \d/);
  });
});
