import { describe, expect, it } from 'vitest';
import { PRICES, PRO_TRIAL_COPY, PRO_TRIAL_PERIOD_DAYS, proTrialCheckoutCta } from './pricing';
import { PRO_TRIAL_PERIOD_DAYS as checkoutTrialDays } from './stripeCheckoutGuard';

describe('Pro trial commercial offer', () => {
  it('publishes a 3-day trial that checkout and copy share', () => {
    expect(PRO_TRIAL_PERIOD_DAYS).toBe(3);
    expect(checkoutTrialDays).toBe(PRO_TRIAL_PERIOD_DAYS);
    expect(PRO_TRIAL_COPY.cta).toBe(`Start ${PRO_TRIAL_PERIOD_DAYS}-day trial`);
    expect(PRO_TRIAL_COPY.featureBullet).toContain(`${PRO_TRIAL_PERIOD_DAYS}-day free trial`);
    expect(PRO_TRIAL_COPY.sectionHint).toContain(`${PRO_TRIAL_PERIOD_DAYS}-day free trial`);
  });

  it('names the post-trial price in dashboard checkout labels', () => {
    expect(proTrialCheckoutCta('$', 'monthly')).toBe(
      `Start ${PRO_TRIAL_PERIOD_DAYS}-day trial ($${PRICES.USD.guardMonthly}/mo after)`,
    );
    expect(proTrialCheckoutCta('$', 'yearly')).toBe(
      `Start ${PRO_TRIAL_PERIOD_DAYS}-day trial ($${PRICES.USD.guardYearly}/yr after)`,
    );
  });
});
