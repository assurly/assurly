import { describe, expect, it } from 'vitest';
import { findingKind, isCiWorkflowSuggestion, isIssueFinding } from './findingKind';

describe('findingKind', () => {
  it.each([
    ['scan-completeness', 'coverage'],
    ['scan-language-coverage', 'coverage'],
    ['dep-registry-unavailable', 'coverage'],
    ['dep-scan-capped', 'coverage'],
    ['github-actions-integration', 'setup'],
    ['assurly-canary-missing', 'setup'],
    ['assurly-canary-planted', 'info'],
    ['supabase-rls', 'issue'],
    ['api-route-unvalidated-input', 'issue'],
    ['dep-nonexistent-package', 'issue'],
  ])('classifies %s as %s', (ruleId, kind) => {
    expect(findingKind({ ruleId, message: 'any' })).toBe(kind);
  });

  it('treats the CI nag persisted under rule `general` as setup, in either brand', () => {
    for (const brand of ['Assurly', 'ShipReady']) {
      const finding = {
        ruleId: 'general',
        message: `GitHub Actions workflow for ${brand} is missing.`,
      };
      expect(isCiWorkflowSuggestion(finding)).toBe(true);
      expect(findingKind(finding)).toBe('setup');
    }
  });

  it('treats missing RLS as an advisory only when no Supabase was detected', () => {
    expect(
      findingKind({
        ruleId: 'supabase-rls',
        message:
          "Database table 'api_keys' is created but Row-Level Security (RLS) is not enabled.",
      }),
    ).toBe('advisory');
    expect(
      findingKind({
        ruleId: 'supabase-rls',
        message:
          "Supabase table 'profiles' is created but Row-Level Security (RLS) is not enabled.",
      }),
    ).toBe('issue');
  });

  it('keeps other `general` findings as issues', () => {
    const finding = { ruleId: 'general', message: 'Hardcoded password in config.' };
    expect(findingKind(finding)).toBe('issue');
    expect(isIssueFinding(finding)).toBe(true);
  });
});
