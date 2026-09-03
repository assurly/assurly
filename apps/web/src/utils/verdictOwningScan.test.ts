import { describe, expect, it } from 'vitest';
import {
  indexLatestVerdictOwningSummaries,
  scanOwnsRepoVerdict,
  selectVerdictOwningScan,
} from './verdictOwningScan';

describe('scanOwnsRepoVerdict', () => {
  it('treats a missing branch and the CLI local sentinel as owning', () => {
    expect(scanOwnsRepoVerdict({})).toBe(true);
    expect(scanOwnsRepoVerdict({ branch: null })).toBe(true);
    expect(scanOwnsRepoVerdict({ branch: 'local' })).toBe(true);
  });

  it('treats main and master as the default branch when none is recorded', () => {
    expect(scanOwnsRepoVerdict({ branch: 'main' })).toBe(true);
    expect(scanOwnsRepoVerdict({ branch: 'master' })).toBe(true);
    expect(scanOwnsRepoVerdict({ branch: 'feat/login' })).toBe(false);
    expect(scanOwnsRepoVerdict({ branch: 'src' })).toBe(false);
  });

  it('uses the recorded GitHub default branch when scan_scope has it', () => {
    expect(
      scanOwnsRepoVerdict({
        branch: 'src',
        scan_scope: { defaultBranch: 'src', scanned: 12 },
      }),
    ).toBe(true);
    expect(
      scanOwnsRepoVerdict({
        branch: 'feat/login',
        scan_scope: { defaultBranch: 'src' },
      }),
    ).toBe(false);
    expect(
      scanOwnsRepoVerdict({
        branch: 'main',
        scan_scope: { defaultBranch: 'src' },
      }),
    ).toBe(false);
  });

  it('never lets a pull-request check own the repository verdict', () => {
    expect(
      scanOwnsRepoVerdict({
        branch: 'main',
        scan_scope: { source: 'pull_request', defaultBranch: 'main' },
      }),
    ).toBe(false);
  });

  /**
   * No scan persisted before this rule shipped records a default branch, so the
   * main/master guess decided every legacy row. A repository whose real default
   * is something else (tibco87/Anima ships from `src`) had its feature-branch
   * `main` scan promoted to the repo verdict, and a public badge attested it.
   */
  it('prefers the repository default over the main/master guess', () => {
    expect(scanOwnsRepoVerdict({ branch: 'main' }, 'src')).toBe(false);
    expect(scanOwnsRepoVerdict({ branch: 'src' }, 'src')).toBe(true);
  });

  it('prefers the repository default over a default the scan recorded earlier', () => {
    // The repo renamed its default to `src`; a verdict about `main` is no
    // longer a verdict about what ships, however correct it was when scanned.
    expect(
      scanOwnsRepoVerdict({ branch: 'main', scan_scope: { defaultBranch: 'main' } }, 'src'),
    ).toBe(false);
    expect(
      scanOwnsRepoVerdict({ branch: 'src', scan_scope: { defaultBranch: 'main' } }, 'src'),
    ).toBe(true);
  });

  it('still recognises the CLI sentinel and branchless rows when a repo default is known', () => {
    expect(scanOwnsRepoVerdict({ branch: 'local' }, 'src')).toBe(true);
    expect(scanOwnsRepoVerdict({ branch: null }, 'src')).toBe(true);
  });

  it('never lets a pull request own the verdict even on the default branch', () => {
    expect(
      scanOwnsRepoVerdict({ branch: 'src', scan_scope: { source: 'pull_request' } }, 'src'),
    ).toBe(false);
  });

  it('ignores a blank or oversized repository default rather than trusting it', () => {
    expect(scanOwnsRepoVerdict({ branch: 'main' }, '  ')).toBe(true);
    expect(scanOwnsRepoVerdict({ branch: 'main' }, 'x'.repeat(256))).toBe(true);
  });
});

describe('selectVerdictOwningScan', () => {
  it('returns the newest default-branch scan, skipping a newer feature branch', () => {
    const feature = { id: 'pr', branch: 'feat/login', created_at: '2026-08-10T00:00:00.000Z' };
    const main = { id: 'main', branch: 'main', created_at: '2026-08-01T00:00:00.000Z' };
    expect(selectVerdictOwningScan([feature, main])?.id).toBe('main');
  });

  it('returns undefined when every scan is on a feature branch', () => {
    expect(
      selectVerdictOwningScan([
        { id: 'pr', branch: 'feat/login', created_at: '2026-08-10T00:00:00.000Z' },
      ]),
    ).toBeUndefined();
  });

  it('skips a main-branch scan when the repository ships from another branch', () => {
    const main = { id: 'main', branch: 'main', created_at: '2026-08-10T00:00:00.000Z' };
    const src = { id: 'src', branch: 'src', created_at: '2026-08-01T00:00:00.000Z' };
    expect(selectVerdictOwningScan([main, src], 'src')?.id).toBe('src');
    expect(selectVerdictOwningScan([main], 'src')).toBeUndefined();
  });
});

describe('indexLatestVerdictOwningSummaries', () => {
  it('indexes the newest owning scan per repository in one pass', () => {
    const rows = [
      {
        id: 'pr-a',
        repository_id: 'repo-a',
        branch: 'feat/login',
        ship_score: 10,
        created_at: '2026-08-10T00:00:00.000Z',
      },
      {
        id: 'main-a',
        repository_id: 'repo-a',
        branch: 'main',
        ship_score: 80,
        created_at: '2026-08-01T00:00:00.000Z',
      },
      {
        id: 'main-b',
        repository_id: 'repo-b',
        branch: 'master',
        ship_score: 96,
        created_at: '2026-08-02T00:00:00.000Z',
      },
    ];
    const map = indexLatestVerdictOwningSummaries(rows);
    expect(map.get('repo-a')?.id).toBe('main-a');
    expect(map.get('repo-b')?.id).toBe('main-b');
    expect(map.has('repo-c')).toBe(false);
  });

  it('applies each repository own default branch from the supplied map', () => {
    const rows = [
      { id: 'main-a', repository_id: 'repo-a', branch: 'main', created_at: '2026-08-10T00:00:00Z' },
      { id: 'src-a', repository_id: 'repo-a', branch: 'src', created_at: '2026-08-01T00:00:00Z' },
      { id: 'main-b', repository_id: 'repo-b', branch: 'main', created_at: '2026-08-02T00:00:00Z' },
    ];
    // repo-a ships from `src`; repo-b is absent from the map and keeps the guess.
    const map = indexLatestVerdictOwningSummaries(rows, new Map([['repo-a', 'src']]));
    expect(map.get('repo-a')?.id).toBe('src-a');
    expect(map.get('repo-b')?.id).toBe('main-b');
  });

  it('reports no owning scan when a repository has none on its default branch', () => {
    const rows = [
      { id: 'main-a', repository_id: 'repo-a', branch: 'main', created_at: '2026-08-10T00:00:00Z' },
    ];
    expect(
      indexLatestVerdictOwningSummaries(rows, new Map([['repo-a', 'src']])).has('repo-a'),
    ).toBe(false);
  });
});
