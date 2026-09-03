import { describe, expect, it, vi } from 'vitest';
import type { LatestScanSummary, Repository, Scan, Target } from './dbAdapter';
import {
  classifyProjectionMode,
  formatReconcileLine,
  planRepoTargetProjection,
  shouldWriteProjection,
} from './reconcileRepoTargetProjections';

const REPO_ID = 'a26e03a7-42b0-42be-b2c9-fd685ea177a0';
const CHECKED_AT = '2026-08-09T19:47:28.312Z';

function repo(name: string): Repository {
  return {
    id: REPO_ID,
    organization_id: 'org-1',
    name,
    github_repo_id: 1,
    is_active: true,
    created_at: CHECKED_AT,
  };
}

function targetRow(
  overrides: Partial<Target> & Pick<Target, 'identifier' | 'current_ship_score'>,
): Target {
  return {
    id: 'target-1',
    organization_id: 'org-1',
    kind: 'repo',
    display_name: overrides.identifier,
    repository_id: REPO_ID,
    generator_fingerprint: null,
    ownership_verified: false,
    ownership_method: null,
    current_verdict: 'ready',
    verdict_evidence: {},
    last_checked_at: CHECKED_AT,
    badge_token: null,
    created_at: CHECKED_AT,
    updated_at: CHECKED_AT,
    ...overrides,
  };
}

function scanRow(overrides: Partial<Scan> = {}): Scan {
  return {
    id: 'scan-1',
    repository_id: REPO_ID,
    commit_sha: 'abc',
    branch: 'main',
    status: 'success',
    error_count: 0,
    warning_count: 0,
    created_at: CHECKED_AT,
    ship_score: 96,
    verdict: 'ready',
    scanned_file_count: 12,
    clean_file_count: 12,
    failure_reason: null,
    ...overrides,
  };
}

function summaryFrom(scan: Scan): LatestScanSummary {
  return {
    id: scan.id,
    repository_id: scan.repository_id,
    ship_score: scan.ship_score ?? null,
    created_at: scan.created_at,
    verdict: scan.verdict,
    failure_reason: scan.failure_reason,
    branch: scan.branch,
    scan_scope: scan.scan_scope,
  };
}

function dbWith(scan: Scan, findings: unknown[] = []) {
  return {
    getRecentScans: vi.fn().mockResolvedValue([scan]),
    getScanFindings: vi.fn().mockResolvedValue(findings),
  };
}

describe('classifyProjectionMode', () => {
  it('labels a missing targets row as missing', () => {
    expect(classifyProjectionMode(null, 59, false)).toBe('missing');
  });

  it('labels a stored 0 that disagrees as zero', () => {
    expect(classifyProjectionMode(0, 96, true)).toBe('zero');
  });

  it('labels a non-zero stored disagreement as stale', () => {
    expect(classifyProjectionMode(36, 59, true)).toBe('stale');
    expect(classifyProjectionMode(92, 100, true)).toBe('stale');
  });

  it('labels equal stored and resolved scores as already in agreement', () => {
    expect(classifyProjectionMode(96, 96, true)).toBe('already-in-agreement');
    expect(classifyProjectionMode(0, 0, true)).toBe('already-in-agreement');
    expect(classifyProjectionMode(null, null, true)).toBe('already-in-agreement');
  });

  /**
   * A stored score with nothing left to resolve from is not a repair: writing
   * it clears a live badge and a paid-API answer. Lumping it in with `stale`
   * made the dry-run line indistinguishable from `stored=36 resolved=59`.
   */
  it('labels a stored score with no owning scan as orphaned, not stale', () => {
    expect(classifyProjectionMode(96, null, true)).toBe('orphaned');
    expect(classifyProjectionMode(0, null, true)).toBe('orphaned');
  });
});

describe('shouldWriteProjection', () => {
  const orphaned = {
    kind: 'reconcile',
    identifier: 'acme/app',
    stored: 96,
    resolved: null,
    mode: 'orphaned',
  } as const;

  it('never clears an orphaned projection unless clearing was asked for', () => {
    expect(shouldWriteProjection(orphaned)).toBe(false);
    expect(shouldWriteProjection(orphaned, { resetOrphaned: false })).toBe(false);
    expect(shouldWriteProjection(orphaned, { resetOrphaned: true })).toBe(true);
  });

  it('still writes the repair modes, and never writes an agreement', () => {
    const plan = (mode: 'stale' | 'missing' | 'zero' | 'already-in-agreement') =>
      ({ kind: 'reconcile', identifier: 'acme/app', stored: 1, resolved: 2, mode }) as const;
    expect(shouldWriteProjection(plan('stale'))).toBe(true);
    expect(shouldWriteProjection(plan('missing'))).toBe(true);
    expect(shouldWriteProjection(plan('zero'))).toBe(true);
    expect(shouldWriteProjection(plan('already-in-agreement'))).toBe(false);
  });
});

describe('planRepoTargetProjection', () => {
  it('includes a repository that has a scan but no target row', async () => {
    const scan = scanRow({ ship_score: 59, verdict: 'blocked', status: 'failed' });
    const plan = await planRepoTargetProjection({
      repo: repo('yablko/PHPAuth'),
      target: null,
      latestSummary: summaryFrom(scan),
      db: dbWith(scan),
    });

    expect(plan).toEqual({
      kind: 'reconcile',
      identifier: 'yablko/PHPAuth',
      stored: null,
      resolved: 59,
      mode: 'missing',
    });
  });

  it('leaves a repository already in agreement alone', async () => {
    const scan = scanRow({ ship_score: 96, verdict: 'ready' });
    const target = targetRow({
      identifier: 'acme/saas',
      current_ship_score: 96,
      current_verdict: 'ready',
    });
    const db = dbWith(scan);
    const plan = await planRepoTargetProjection({
      repo: repo('acme/saas'),
      target,
      latestSummary: summaryFrom(scan),
      db,
    });

    expect(plan).toEqual({
      kind: 'reconcile',
      identifier: 'acme/saas',
      stored: 96,
      resolved: 96,
      mode: 'already-in-agreement',
    });
    expect(db.getRecentScans).not.toHaveBeenCalled();
    expect(db.getScanFindings).not.toHaveBeenCalled();
  });

  it('classifies a stored zero against a real scan score', async () => {
    const scan = scanRow({ ship_score: 96, verdict: 'ready' });
    const plan = await planRepoTargetProjection({
      repo: repo('tibco87/Relax_ios'),
      target: targetRow({
        identifier: 'tibco87/Relax_ios',
        current_ship_score: 0,
        current_verdict: 'ready',
      }),
      latestSummary: summaryFrom(scan),
      db: dbWith(scan),
    });

    expect(plan).toMatchObject({
      kind: 'reconcile',
      identifier: 'tibco87/Relax_ios',
      stored: 0,
      resolved: 96,
      mode: 'zero',
    });
  });

  it('skips a scan that did not complete (failure_reason set)', async () => {
    const scan = scanRow({
      ship_score: 0,
      verdict: 'failed',
      status: 'failed',
      failure_reason: 'no_eligible_files',
    });
    const plan = await planRepoTargetProjection({
      repo: repo('tibco87/SentinelLog'),
      target: targetRow({
        identifier: 'tibco87/SentinelLog',
        current_ship_score: null,
        current_verdict: 'unknown',
      }),
      latestSummary: summaryFrom(scan),
      db: dbWith(scan),
    });

    expect(plan).toEqual({
      kind: 'skip-failed',
      identifier: 'tibco87/SentinelLog',
      failureReason: 'no_eligible_files',
    });
  });

  it('does not skip a blocked gate whose status is failed but failure_reason is null', async () => {
    const scan = scanRow({
      ship_score: 59,
      verdict: 'blocked',
      status: 'failed',
      failure_reason: null,
    });
    const plan = await planRepoTargetProjection({
      repo: repo('acme/blocked'),
      target: targetRow({
        identifier: 'acme/blocked',
        current_ship_score: 36,
        current_verdict: 'blocked',
      }),
      latestSummary: summaryFrom(scan),
      db: dbWith(scan),
    });

    expect(plan).toMatchObject({
      kind: 'reconcile',
      identifier: 'acme/blocked',
      stored: 36,
      resolved: 59,
      mode: 'stale',
    });
  });

  it('inherits the default-branch rule from buildRepoTargetCard', async () => {
    const feature = scanRow({
      id: 'scan-pr',
      branch: 'feat/login',
      ship_score: 10,
      verdict: 'ready',
      created_at: '2026-08-12T00:00:00.000Z',
    });
    const main = scanRow({
      id: 'scan-main',
      branch: 'main',
      ship_score: 80,
      verdict: 'ready',
      created_at: '2026-08-01T00:00:00.000Z',
    });
    const db = {
      getRecentScans: vi.fn().mockResolvedValue([feature, main]),
      getScanFindings: vi.fn().mockResolvedValue([]),
    };
    const plan = await planRepoTargetProjection({
      repo: repo('acme/with-pr'),
      target: targetRow({
        identifier: 'acme/with-pr',
        current_ship_score: 80,
        current_verdict: 'ready',
      }),
      latestSummary: { ...summaryFrom(feature), branch: 'feat/login' },
      db,
    });
    expect(plan).toMatchObject({
      kind: 'reconcile',
      stored: 80,
      resolved: 80,
      mode: 'already-in-agreement',
    });
    expect(plan.kind === 'reconcile' && plan.resolved).not.toBe(10);
  });

  it('resolves a repository with only feature-branch scans as unscanned', async () => {
    const feature = scanRow({
      id: 'scan-pr',
      branch: 'feat/login',
      ship_score: 10,
      verdict: 'ready',
    });
    const plan = await planRepoTargetProjection({
      repo: repo('acme/pr-only'),
      target: null,
      latestSummary: { ...summaryFrom(feature), branch: 'feat/login' },
      db: dbWith(feature),
    });
    expect(plan).toEqual({
      kind: 'reconcile',
      identifier: 'acme/pr-only',
      stored: null,
      resolved: null,
      mode: 'missing',
    });
  });

  it('flags a scored projection whose scans are all off the default branch as orphaned', async () => {
    const feature = scanRow({ id: 'scan-feat', branch: 'feat/login', ship_score: 10 });
    const plan = await planRepoTargetProjection({
      repo: repo('acme/app'),
      target: targetRow({ identifier: 'acme/app', current_ship_score: 96 }),
      latestSummary: null,
      db: dbWith(feature),
    });
    expect(plan).toEqual({
      kind: 'reconcile',
      identifier: 'acme/app',
      stored: 96,
      resolved: null,
      mode: 'orphaned',
    });
  });

  /**
   * tibco87/Anima ships from `src`; its only scored scan is on `main`. Before
   * the repository default was recorded, `main` was assumed to be the default
   * and that scan drove the card and a public badge.
   */
  it('stops a main-branch scan owning a repository that ships from another branch', async () => {
    const onMain = scanRow({ id: 'scan-main', branch: 'main', ship_score: 59, verdict: 'blocked' });
    const plan = await planRepoTargetProjection({
      repo: { ...repo('tibco87/Anima'), default_branch: 'src' },
      target: targetRow({ identifier: 'tibco87/Anima', current_ship_score: 59 }),
      latestSummary: summaryFrom(onMain),
      db: dbWith(onMain),
    });
    expect(plan).toEqual({
      kind: 'reconcile',
      identifier: 'tibco87/Anima',
      stored: 59,
      resolved: null,
      mode: 'orphaned',
    });
  });

  it('keeps the card when the scan is on the repository real default branch', async () => {
    const onSrc = scanRow({ id: 'scan-src', branch: 'src', ship_score: 96, verdict: 'ready' });
    const plan = await planRepoTargetProjection({
      repo: { ...repo('tibco87/Anima'), default_branch: 'src' },
      target: targetRow({ identifier: 'tibco87/Anima', current_ship_score: 96 }),
      latestSummary: summaryFrom(onSrc),
      db: dbWith(onSrc),
    });
    expect(plan).toMatchObject({ kind: 'reconcile', resolved: 96, mode: 'already-in-agreement' });
  });
});

describe('formatReconcileLine', () => {
  it('prints identifier, stored, resolved, and mode', () => {
    expect(
      formatReconcileLine(
        {
          kind: 'reconcile',
          identifier: 'tibco87/PHPAuth',
          stored: 36,
          resolved: 59,
          mode: 'stale',
        },
        false,
      ),
    ).toBe('score  tibco87/PHPAuth  stored=36  resolved=59  stale  would write');
    expect(
      formatReconcileLine(
        {
          kind: 'reconcile',
          identifier: 'acme/saas',
          stored: 96,
          resolved: 96,
          mode: 'already-in-agreement',
        },
        false,
      ),
    ).toBe('score  acme/saas  stored=96  resolved=96  already-in-agreement');
  });

  /**
   * The dry-run is the only thing an operator reads before approving `--apply`,
   * so an erase has to read as an erase — not as another "would write".
   */
  it('says an orphaned projection is being kept, and what would clear it', () => {
    const orphaned = {
      kind: 'reconcile',
      identifier: 'tibco87/Anima',
      stored: 59,
      resolved: null,
      mode: 'orphaned',
    } as const;
    expect(formatReconcileLine(orphaned, false)).toBe(
      'score  tibco87/Anima  stored=59  resolved=null  orphaned  kept (no scan owns the verdict; --reset-orphaned clears it)',
    );
    expect(formatReconcileLine(orphaned, false, { resetOrphaned: true })).toBe(
      'score  tibco87/Anima  stored=59  resolved=null  orphaned  would clear',
    );
    expect(formatReconcileLine(orphaned, true, { resetOrphaned: true })).toBe(
      'score  tibco87/Anima  stored=59  resolved=null  orphaned  clear',
    );
  });
});
