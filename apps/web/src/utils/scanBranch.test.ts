import { describe, expect, it } from 'vitest';
import {
  branchQueryParam,
  parseGithubBranchList,
  suggestAlternateScanBranches,
} from './scanBranch';

describe('branchQueryParam', () => {
  it('omits the query when no branch is selected', () => {
    expect(branchQueryParam(null)).toBe('');
    expect(branchQueryParam(undefined)).toBe('');
    expect(branchQueryParam('')).toBe('');
  });

  it('encodes the selected branch', () => {
    expect(branchQueryParam('main')).toBe('&branch=main');
    expect(branchQueryParam('feat/scan')).toBe('&branch=feat%2Fscan');
  });
});

describe('parseGithubBranchList', () => {
  it('reads default_branch and names from a GitHub proxy payload', () => {
    expect(
      parseGithubBranchList({ default_branch: 'src', branches: ['src', 'main', 12, ''] }),
    ).toEqual({
      default_branch: 'src',
      branches: ['src', 'main'],
    });
  });
});

describe('suggestAlternateScanBranches', () => {
  it('puts main ahead of other remaining branches', () => {
    expect(suggestAlternateScanBranches('src', ['src', 'develop', 'main'])).toEqual([
      'main',
      'develop',
    ]);
  });

  it('returns an empty list when the current branch is the only one', () => {
    expect(suggestAlternateScanBranches('main', ['main'])).toEqual([]);
  });
});
