import { describe, expect, it } from 'vitest';
import {
  GITHUB_ACTIONS_EXISTING_CI_MESSAGE,
  GITHUB_ACTIONS_MISSING_ASSURLY_MESSAGE,
} from '@assurly/scanner-core';
import { getCuratedConsequence, getCuratedConsequenceForFinding } from './consequenceMap';

const NO_CI = 'automated checks are not wired up';
const EXISTING_CI = 'Your CI runs, but no step checks this app before deploy';

describe('getCuratedConsequenceForFinding github-actions-integration', () => {
  it('keeps the no-CI copy when no workflows exist', () => {
    const entry = getCuratedConsequenceForFinding({
      ruleId: 'github-actions-integration',
      message: GITHUB_ACTIONS_MISSING_ASSURLY_MESSAGE,
    });

    expect(entry?.consequence).toContain(NO_CI);
    expect(entry).toEqual(getCuratedConsequence('github-actions-integration'));
  });

  it('uses the existing-CI copy when workflows exist without an Assurly step', () => {
    const entry = getCuratedConsequenceForFinding({
      ruleId: 'github-actions-integration',
      message: GITHUB_ACTIONS_EXISTING_CI_MESSAGE,
    });

    expect(entry?.consequence).toContain(EXISTING_CI);
    expect(entry?.consequence).not.toContain(NO_CI);
  });
});
