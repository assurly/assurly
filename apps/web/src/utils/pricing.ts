export type Currency = 'USD' | 'EUR';

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
export const PRICES: Record<Currency, CurrencyPrices> = {
  USD: {
    free: 0,
    guardMonthly: 19,
    guardYearly: 149,
    guardMonthlyEquiv: 12.4,
  },
  EUR: {
    free: 0,
    guardMonthly: 17,
    guardYearly: 130,
    guardMonthlyEquiv: 10.8,
  },
};
