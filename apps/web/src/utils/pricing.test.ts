import { describe, expect, it } from 'vitest';
import {
  CURRENCY_CODE,
  CURRENCY_SYMBOL,
  PRICES,
  PRO_TRIAL_COPY,
  PRO_TRIAL_PERIOD_DAYS,
  proTrialCheckoutCta,
} from './pricing';
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
    expect(proTrialCheckoutCta('monthly')).toBe(
      `Start ${PRO_TRIAL_PERIOD_DAYS}-day trial (€${PRICES.guardMonthly}/mo after)`,
    );
    expect(proTrialCheckoutCta('yearly')).toBe(
      `Start ${PRO_TRIAL_PERIOD_DAYS}-day trial (€${PRICES.guardYearly}/yr after)`,
    );
  });
});

/**
 * Stripe holds exactly two live prices for Assurly Pro — €17/month and
 * €130/year — and no USD price. A Stripe customer's currency also locks after
 * their first invoice. Quoting dollars anywhere therefore advertises a price
 * checkout cannot charge, so the published numbers are pinned here.
 */
describe('published currency', () => {
  it('is euros, matching the only prices Stripe can charge', () => {
    expect(CURRENCY_CODE).toBe('EUR');
    expect(CURRENCY_SYMBOL).toBe('€');
    expect(PRICES.guardMonthly).toBe(17);
    expect(PRICES.guardYearly).toBe(130);
    expect(PRICES.free).toBe(0);
  });

  it('offers no second currency to drift out of step with Stripe', () => {
    expect(Object.keys(PRICES).sort()).toEqual([
      'free',
      'guardMonthly',
      'guardMonthlyEquiv',
      'guardYearly',
    ]);
  });

  it('never prints a dollar figure in trial copy', () => {
    const copy = [
      ...Object.values(PRO_TRIAL_COPY),
      proTrialCheckoutCta('monthly'),
      proTrialCheckoutCta('yearly'),
    ].join(' ');
    expect(copy).not.toContain('$');
  });

  it('keeps the monthly equivalent consistent with the yearly price', () => {
    expect(PRICES.guardMonthlyEquiv).toBeCloseTo(PRICES.guardYearly / 12, 1);
  });
});
