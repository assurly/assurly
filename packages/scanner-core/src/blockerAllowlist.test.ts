import { describe, expect, it } from 'vitest';
import {
  HIGH_CONFIDENCE_BLOCKER_RULE_IDS,
  isHighConfidenceBlockerRuleId,
} from './blockerAllowlist';

describe('HIGH_CONFIDENCE_BLOCKER_RULE_IDS', () => {
  it('keeps undocumented-env off the ship-blocker allowlist', () => {
    expect(HIGH_CONFIDENCE_BLOCKER_RULE_IDS).not.toContain('undocumented-env');
    expect(isHighConfidenceBlockerRuleId('undocumented-env')).toBe(false);
  });

  it('never promotes canary rules to blockers', () => {
    expect(HIGH_CONFIDENCE_BLOCKER_RULE_IDS).not.toContain('assurly-canary-missing');
    expect(HIGH_CONFIDENCE_BLOCKER_RULE_IDS).not.toContain('assurly-canary-planted');
    expect(HIGH_CONFIDENCE_BLOCKER_RULE_IDS).not.toContain('assurly-canary-in-client');
    expect(isHighConfidenceBlockerRuleId('assurly-canary-missing')).toBe(false);
    expect(isHighConfidenceBlockerRuleId('assurly-canary-in-client')).toBe(false);
  });

  it('keeps real security rules on the allowlist', () => {
    expect(isHighConfidenceBlockerRuleId('supabase-rls')).toBe(true);
    expect(isHighConfidenceBlockerRuleId('stripe-webhook-signature')).toBe(true);
    expect(isHighConfidenceBlockerRuleId('public-secret')).toBe(true);
  });
});
