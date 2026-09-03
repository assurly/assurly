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

interface LatestScanFixture {
  shipScore: number | null;
  branch?: string;
  /** Gate verdict on the scan row. Independent of `targets.current_verdict`. */
  verdict?: Target['current_verdict'] | 'failed' | null;
  findings?: Array<{
    id: string;
    scan_id: string;
    rule_id: string;
    severity: 'error' | 'warning';
    confidence: 'high';
    file_path: string;
    line_number: number;
    message: string;
    suggestion: string;
    created_at: string;
  }>;
}

/** Live PHPAuth findings: grouped RLS blockers recompute to BLOCKED_SCORE_CAP (59). */
function phpAuthFindings(): NonNullable<LatestScanFixture['findings']> {
  const tables = ['attempts', 'config', 'requests', 'sessions', 'users'];
  return [
    ...tables.map((table, index) => ({
      id: `rls-${table}`,
      scan_id: 'scan-1',
      rule_id: 'supabase-rls',
      severity: 'error' as const,
      confidence: 'high' as const,
      file_path: 'database.sql',
      line_number: index + 1,
      message: `Supabase table '${table}' is created but Row-Level Security (RLS) is not enabled.`,
      suggestion: '',
      created_at: CHECKED_AT,
    })),
    {
      id: 'warn-gha',
      scan_id: 'scan-1',
      rule_id: 'github-actions-integration',
      severity: 'warning' as const,
      confidence: 'high' as const,
      file_path: 'Global Configs',
      line_number: 1,
      message: 'GitHub Actions workflow for Assurly is missing.',
      suggestion: '',
      created_at: CHECKED_AT,
    },
  ];
}

/**
 * The dashboard card. When `latestScan` is omitted the scan row carries the
 * same stored score as the target — the fixture both surfaces resolve from
 * after a consistent write. Pass `latestScan` to pin the production case
 * where the two columns disagree. Pass `target: null` for a repo that has
 * scans but no `targets` row.
 */
async function dashboardScore(
  target: Target | null,
  latestScan?: LatestScanFixture,
  repoName?: string,
): Promise<number | null> {
  const identifier = target?.identifier ?? repoName;
  if (!identifier) {
    throw new Error('dashboardScore requires a target identifier or repoName');
  }
  const scanVerdict = latestScan?.verdict ?? target?.current_verdict ?? null;
  const scanRow =
    latestScan !== undefined
      ? {
          id: 'scan-1',
          repository_id: REPO_ID,
          ship_score: latestScan.shipScore,
          verdict: scanVerdict,
          branch: latestScan.branch ?? 'main',
          scanned_file_count: null,
          clean_file_count: null,
          created_at: CHECKED_AT,
        }
      : target?.current_ship_score == null
        ? null
        : {
            id: 'scan-1',
            repository_id: REPO_ID,
            ship_score: target.current_ship_score,
            verdict: target.current_verdict,
            scanned_file_count: null,
            clean_file_count: null,
            created_at: CHECKED_AT,
          };
  const db = {
    getOrganizationByUserId: vi
      .fn()
      .mockResolvedValue({ id: ORG_ID, name: 'acme', billing_plan: 'pro' }),
    getRepositories: vi
      .fn()
      .mockResolvedValue([{ id: REPO_ID, organization_id: ORG_ID, name: identifier }]),
    getTargets: vi.fn().mockResolvedValue(target ? [target] : []),
    getLatestScanSummaries: vi
      .fn()
      .mockResolvedValue(scanRow ? new Map([[REPO_ID, scanRow]]) : new Map()),
    getRecentScans: vi.fn().mockResolvedValue(scanRow ? [scanRow] : []),
    getScanFindings: vi.fn().mockResolvedValue(latestScan?.findings ?? []),
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

interface HistoryScanFixture {
  id: string;
  branch: string;
  shipScore: number | null;
  verdict?: Target['current_verdict'] | 'failed' | null;
  createdAt: string;
}

/**
 * Dashboard card when more than one scan exists. `getLatestScanSummaries` is
 * mocked as today's unfiltered lookup (newest row, any branch) so a regression
 * that trusts that row without the default-branch rule fails these cases.
 */
async function dashboardScoreFromHistory(
  target: Target | null,
  scansNewestFirst: HistoryScanFixture[],
  repoName?: string,
): Promise<number | null> {
  const identifier = target?.identifier ?? repoName;
  if (!identifier) {
    throw new Error('dashboardScoreFromHistory requires a target identifier or repoName');
  }
  const rows = scansNewestFirst.map((scan) => ({
    id: scan.id,
    repository_id: REPO_ID,
    ship_score: scan.shipScore,
    verdict: scan.verdict ?? target?.current_verdict ?? null,
    branch: scan.branch,
    scanned_file_count: null,
    clean_file_count: null,
    created_at: scan.createdAt,
  }));
  const latest = rows[0];
  const db = {
    getOrganizationByUserId: vi
      .fn()
      .mockResolvedValue({ id: ORG_ID, name: 'acme', billing_plan: 'pro' }),
    getRepositories: vi
      .fn()
      .mockResolvedValue([{ id: REPO_ID, organization_id: ORG_ID, name: identifier }]),
    getTargets: vi.fn().mockResolvedValue(target ? [target] : []),
    getLatestScanSummaries: vi
      .fn()
      .mockResolvedValue(latest ? new Map([[REPO_ID, latest]]) : new Map()),
    getRecentScans: vi.fn().mockResolvedValue(rows),
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
  return body.targets[0]?.shipScore ?? null;
}

/** The keyed verdict API — the number the MCP `assurly_verdict` tool relays. */
async function verdictApiScore(target: Target | null, repoName?: string): Promise<number | null> {
  const identifier = target?.identifier ?? repoName;
  if (!identifier) {
    throw new Error('verdictApiScore requires a target identifier or repoName');
  }
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
    new Request(`http://localhost/api/v1/verdict?repo=${encodeURIComponent(identifier)}`, {
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

  /**
   * Data-driven divergence, not a clamp bug. The dashboard prefers the scan
   * row; a null `scans.ship_score` forces a findings recompute (59). The keyed
   * API, trust page and badge read `targets.current_ship_score` (36). A
   * consistent backfill of both columns closes this; do not weaken the fixture
   * until the columns agree.
   */
  it('documents the live PHPAuth shape: null scan score vs stored target 36', async () => {
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
    const latestScan = { shipScore: null, findings: phpAuthFindings() };

    const dashboard = await dashboardScore(target, latestScan);
    const keyed = await verdictApiScore(target);
    const trust = await trustScore(target);

    expect(dashboard).toBe(BLOCKED_SCORE_CAP);
    expect(keyed).toBe(36);
    expect(trust).toBe(36);
    expect(toPublicTrustProjection(target)?.shipScore).toBe(36);
    expect(await badgeSvg(target)).toContain('Ship Score 36/100');
    expect(keyed).not.toBe(dashboard);
  });

  /**
   * Different input numbers, same displayed number. The dashboard clamps the
   * scan row (96 → 79); the keyed API already holds the capped target column.
   * This is the live tibco87/ShipReady shape — equality holds because of the
   * coverage cap, not because the fixture forced the columns to match.
   */
  it('reports one number when the live ShipReady scan row is 96 and the target stores 79', async () => {
    const target = makeTarget({
      identifier: 'tibco87/ShipReady',
      storedScore: 79,
      verdict: 'review',
      topIssue: {
        key: 'rule:scan-completeness',
        label: 'Scan is incomplete',
        severity: 'warning',
      },
    });

    const dashboard = await dashboardScore(target, { shipScore: 96 });
    expect(await verdictApiScore(target)).toBe(dashboard);
    expect(await trustScore(target)).toBe(dashboard);
    expect(toPublicTrustProjection(target)?.shipScore).toBe(dashboard);
    expect(await badgeSvg(target)).toContain(`Ship Score ${dashboard}/100`);
    expect(dashboard).toBe(INCOMPLETE_SCORE_CAP);
  });

  /**
   * Production measured 7/24 repos where the dashboard and the keyed API
   * select different numbers. These fixtures hold those two sources apart on
   * purpose. Until the projection backfill runs they must disagree — asserting
   * equality here would hide the class of bug this file exists to catch.
   */
  describe('production source-divergence modes', () => {
    it('stale target vs null scan score (PHPAuth): dashboard recomputes, keyed API keeps 36', async () => {
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
      const dashboard = await dashboardScore(target, {
        shipScore: null,
        verdict: 'blocked',
        findings: phpAuthFindings(),
      });
      const keyed = await verdictApiScore(target);

      expect(dashboard).toBe(BLOCKED_SCORE_CAP);
      expect(keyed).toBe(36);
      expect(await trustScore(target)).toBe(36);
      expect(await badgeSvg(target)).toContain('Ship Score 36/100');
      // Legitimately different until the projection is rewritten to 59.
      expect(keyed).not.toBe(dashboard);
    });

    it('stale target vs a different scan score (Portfolio): dashboard prefers 100, keyed API keeps 92', async () => {
      const target = makeTarget({
        identifier: 'tibco87/Portfolio',
        storedScore: 92,
        verdict: 'ready',
      });
      const dashboard = await dashboardScore(target, { shipScore: 100, verdict: 'ready' });
      const keyed = await verdictApiScore(target);

      expect(dashboard).toBe(100);
      expect(keyed).toBe(92);
      expect(await trustScore(target)).toBe(92);
      expect(toPublicTrustProjection(target)?.shipScore).toBe(92);
      expect(await badgeSvg(target)).toContain('Ship Score 92/100');
      // Legitimately different until the projection is rewritten to 100.
      expect(keyed).not.toBe(dashboard);
    });

    it('no target row, scan present (yablko/PHPAuth): dashboard derives 59, keyed API is unknown', async () => {
      const dashboard = await dashboardScore(
        null,
        {
          shipScore: null,
          verdict: 'blocked',
          findings: phpAuthFindings(),
        },
        'yablko/PHPAuth',
      );
      const keyed = await verdictApiScore(null, 'yablko/PHPAuth');

      expect(dashboard).toBe(BLOCKED_SCORE_CAP);
      expect(keyed).toBeNull();
      // No projection means no badge token and no public trust page.
      mocks.getAdminDbAdapter.mockReturnValue({
        getTargetByBadgeToken: vi.fn().mockResolvedValue(null),
        getScanByShareToken: vi.fn().mockResolvedValue(null),
        getScanFindings: vi.fn().mockResolvedValue([]),
      });
      const trust = await trustGET(new Request(`http://localhost/api/trust/${BADGE_TOKEN}`), {
        params: Promise.resolve({ token: BADGE_TOKEN }),
      });
      const badge = await badgeGET(new Request(`http://localhost/api/badge/${BADGE_TOKEN}`), {
        params: Promise.resolve({ token: BADGE_TOKEN }),
      });
      expect(trust.status).toBe(404);
      expect(badge.status).toBe(404);
      // Legitimately different until a projection row is created.
      expect(keyed).not.toBe(dashboard);
    });

    it('stored zero vs a real scan score (Relax_ios): dashboard prefers 96, keyed API reports 0', async () => {
      const target = makeTarget({
        identifier: 'tibco87/Relax_ios',
        storedScore: 0,
        verdict: 'ready',
      });
      const dashboard = await dashboardScore(target, { shipScore: 96, verdict: 'ready' });
      const keyed = await verdictApiScore(target);

      expect(dashboard).toBe(96);
      expect(keyed).toBe(0);
      expect(await trustScore(target)).toBe(0);
      expect(toPublicTrustProjection(target)?.shipScore).toBe(0);
      expect(await badgeSvg(target)).toContain('Ship Score 0/100');
      // Legitimately different until the stored 0 is rewritten to 96.
      expect(keyed).not.toBe(dashboard);
    });
  });

  describe('default-branch scan owns the repository verdict', () => {
    it('agrees when the latest scan is on main', async () => {
      const target = makeTarget({
        identifier: 'acme/on-main',
        storedScore: 80,
        verdict: 'ready',
      });
      const dashboard = await dashboardScoreFromHistory(target, [
        {
          id: 'scan-main',
          branch: 'main',
          shipScore: 80,
          verdict: 'ready',
          createdAt: '2026-08-10T00:00:00.000Z',
        },
      ]);
      const keyed = await verdictApiScore(target);
      expect(dashboard).toBe(80);
      expect(keyed).toBe(80);
    });

    it('ignores a newer feature-branch scan and reports the older main scan on both surfaces', async () => {
      const target = makeTarget({
        identifier: 'acme/with-pr',
        storedScore: 80,
        verdict: 'ready',
      });
      const dashboard = await dashboardScoreFromHistory(target, [
        {
          id: 'scan-pr',
          branch: 'feat/login',
          shipScore: 10,
          verdict: 'ready',
          createdAt: '2026-08-12T00:00:00.000Z',
        },
        {
          id: 'scan-main',
          branch: 'main',
          shipScore: 80,
          verdict: 'ready',
          createdAt: '2026-08-01T00:00:00.000Z',
        },
      ]);
      const keyed = await verdictApiScore(target);
      expect(dashboard).toBe(80);
      expect(keyed).toBe(80);
      expect(dashboard).not.toBe(10);
    });

    it('shows unscanned on both surfaces when the only scans are on a feature branch', async () => {
      const dashboard = await dashboardScoreFromHistory(
        null,
        [
          {
            id: 'scan-pr',
            branch: 'feat/login',
            shipScore: 10,
            verdict: 'ready',
            createdAt: '2026-08-12T00:00:00.000Z',
          },
        ],
        'acme/pr-only',
      );
      const keyed = await verdictApiScore(null, 'acme/pr-only');
      expect(dashboard).toBeNull();
      expect(keyed).toBeNull();
    });
  });
});
