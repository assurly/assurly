import { describe, expect, it } from 'vitest';
import type { Scan, ScanFinding } from './dbAdapter';
import { findResolvedSincePrevious, pickPreviousScan } from './scanResolved';

function scan(id: string, commit: string, createdAt: string, overrides: Partial<Scan> = {}): Scan {
  return {
    id,
    repository_id: 'repo-1',
    commit_sha: commit,
    branch: 'main',
    status: 'success',
    error_count: 0,
    warning_count: 0,
    created_at: createdAt,
    ...overrides,
  };
}

function finding(id: string, ruleId: string, message: string, file = 'src/app.ts'): ScanFinding {
  return {
    id,
    scan_id: 'scan',
    rule_id: ruleId,
    severity: 'warning',
    file_path: file,
    message,
    created_at: '2026-10-14T00:00:00Z',
  };
}

const CONTACT = finding(
  'f1',
  'api-route-unvalidated-input',
  'Route handler reads the request body without validating it against a schema.',
);
const ENV = finding(
  'f2',
  'undocumented-env',
  "Environment variable 'process.env.STRIPE_SECRET_KEY' is used but not documented in '.env.example'.",
);

describe('pickPreviousScan', () => {
  const current = scan('c', 'bbbbbbb1111', '2026-10-15T10:00:00Z');

  it('compares with the newest earlier scan of another commit on the same branch', () => {
    const scans = [
      current,
      scan('same-commit', 'bbbbbbb1111', '2026-10-15T09:00:00Z'),
      scan('other-branch', 'ccccccc2222', '2026-10-15T08:00:00Z', { branch: 'feature' }),
      scan('capped', 'ddddddd3333', '2026-10-15T07:00:00Z', { status: 'failed' }),
      scan('previous', 'aaaaaaa0000', '2026-10-14T12:40:00Z'),
    ];
    expect(pickPreviousScan(scans, current)?.id).toBe('previous');
  });

  it('finds nothing when every earlier scan read the same commit', () => {
    // Attesta today: fifteen rescans of 06b0c6d. Rule changes are not fixes.
    const scans = [current, scan('again', 'bbbbbbb1111', '2026-10-14T12:40:00Z')];
    expect(pickPreviousScan(scans, current)).toBeNull();
  });
});

describe('findResolvedSincePrevious', () => {
  const previous = scan('p', 'aaaaaaa0000999', '2026-10-14T12:40:00Z');

  it('names the problems the previous commit had and this one does not', () => {
    expect(findResolvedSincePrevious(previous, [CONTACT, ENV], [ENV])).toEqual({
      previousCommit: 'aaaaaaa',
      labels: ['An API route accepts any input'],
    });
  });

  it('does not credit findings that are no longer problems under today’s rules', () => {
    const ciNag = finding(
      'f3',
      'github-actions-integration',
      'GitHub Actions workflow for Assurly is missing.',
      'Global Configs',
    );
    expect(findResolvedSincePrevious(previous, [ciNag, ENV], [ENV])).toBeNull();
  });
});
