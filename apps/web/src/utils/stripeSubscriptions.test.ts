import { describe, expect, it } from 'vitest';
import {
  planForSubscriptionStatus,
  requireSafeStripeSearchId,
  subscriptionUsedTrial,
} from './stripeSubscriptions';

describe('stripeSubscriptions helpers', () => {
  it('maps entitled statuses to pro, including past_due during Stripe retries', () => {
    expect(planForSubscriptionStatus('active')).toBe('pro');
    expect(planForSubscriptionStatus('trialing')).toBe('pro');
    expect(planForSubscriptionStatus('past_due')).toBe('pro');
    expect(planForSubscriptionStatus('unpaid')).toBe('free');
    expect(planForSubscriptionStatus('canceled')).toBe('free');
  });

  it('treats a trial_start timestamp as a used trial', () => {
    expect(subscriptionUsedTrial({ trial_start: 1 })).toBe(true);
    expect(subscriptionUsedTrial({ trial_start: null })).toBe(false);
  });

  it('rejects organization ids that would break Stripe Search interpolation', () => {
    expect(requireSafeStripeSearchId('org-a')).toBe('org-a');
    expect(requireSafeStripeSearchId('11111111-1111-4111-8111-111111111111')).toBe(
      '11111111-1111-4111-8111-111111111111',
    );
    expect(() => requireSafeStripeSearchId("org' OR status:'active")).toThrow(
      /not safe for Stripe search/,
    );
  });
});
