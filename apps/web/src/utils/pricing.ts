/**
 * Assurly charges in euros, and only in euros.
 *
 * Stripe holds exactly two live prices for Assurly Pro — €17/month and
 * €130/year — with no USD price, and a Stripe customer's currency locks after
 * their first invoice. Checkout resolves one price id per interval and sends no
 * currency, so any surface quoting dollars advertises a price the checkout
 * cannot charge. Adding a second currency here is not a copy change: it needs
 * matching Stripe prices first.
 */
export const CURRENCY_CODE = 'EUR';
export const CURRENCY_SYMBOL = '€';

export interface CurrencyPrices {
  free: number;
  /** The Pro (per-app) subscription price. The ROI calculator reads these too. */
  guardMonthly: number;
  guardYearly: number;
  /** Yearly price divided over twelve months, shown when yearly billing is picked. */
  guardMonthlyEquiv: number;
}

/**
 * The published price table.
 *
 * Extracted from HomeClient so the pricing cards and the `SoftwareApplication`
 * structured data cannot drift apart. A schema `offers` block that disagrees
 * with the page is worse than none: Google treats a price mismatch as grounds to
 * drop the rich result, and an AI assistant quoting a stale number does damage
 * no correction reaches.
 *
 * The OEM/platform tier is usage- and seat-based and quoted through sales, so it
 * has no fixed number here and is described in the schema as a quote instead.
 */
export const PRICES: CurrencyPrices = {
  free: 0,
  guardMonthly: 17,
  guardYearly: 130,
  guardMonthlyEquiv: 10.8,
};

/**
 * Pro trial length and the sentences that describe it.
 *
 * Checkout grants this many days. Marketing, FAQ, schema.org, and legal copy
 * read the same number so a duration change cannot leave a surface claiming 7.
 * Lives here — not next to Stripe — because client components must not import
 * the checkout guard.
 */
export const PRO_TRIAL_PERIOD_DAYS = 3;

export const PRO_TRIAL_COPY = {
  featureBullet: `${PRO_TRIAL_PERIOD_DAYS}-day free trial — card required, cancel before day ${PRO_TRIAL_PERIOD_DAYS} and you pay nothing`,
  cta: `Start ${PRO_TRIAL_PERIOD_DAYS}-day trial`,
  sectionHint: `Pro includes a ${PRO_TRIAL_PERIOD_DAYS}-day free trial.`,
  checkoutSuccess: `Assurly Pro is active. First-time checkouts include a ${PRO_TRIAL_PERIOD_DAYS}-day trial before any charge.`,
} as const;

export function proTrialCheckoutCta(period: 'monthly' | 'yearly'): string {
  switch (period) {
    case 'yearly':
      return `${PRO_TRIAL_COPY.cta} (${CURRENCY_SYMBOL}${PRICES.guardYearly}/yr after)`;
    case 'monthly':
      return `${PRO_TRIAL_COPY.cta} (${CURRENCY_SYMBOL}${PRICES.guardMonthly}/mo after)`;
    default: {
      const exhaustive: never = period;
      return exhaustive;
    }
  }
}
