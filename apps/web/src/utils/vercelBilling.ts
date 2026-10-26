import type { VercelPlanChangeRow } from './dbAdapter';

/**
 * Pure billing rules for Live Lock on the Vercel Marketplace. No I/O.
 *
 * - The period is the calendar month in UTC.
 * - Pro is billed in arrears: early in a month Assurly invoices the previous
 *   one for the share of it the installation spent on Pro. Moving between
 *   Free and Pro mid-month is fair in both directions, and nothing is ever
 *   charged in advance, so there is never anything to refund on a downgrade.
 * - Amounts are USD decimal strings with two places, as Vercel's billing API
 *   requires.
 *
 * Confirmed against Vercel's Submit Billing Data and Submit Invoice
 * references (2026-10-26): billing data is display-only and should be sent
 * hourly; an invoice needs `invoiceDate` inside the period, a subscription
 * plan id per item, and a unique `externalId` per installation.
 */

/** Vercel bills in USD only. Assurly Pro is €17 through Stripe and $17 here. */
export const PRO_MONTHLY_USD = 17;
export const PRO_PLAN_ID = 'pro';
const ITEM_NAME = 'Assurly Live Lock Pro';

export interface BillingPeriod {
  start: Date;
  end: Date;
}

/** The UTC calendar month that contains `at`. */
export function monthPeriod(at: Date): BillingPeriod {
  const start = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), 1));
  const end = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth() + 1, 1));
  return { start, end };
}

/** The UTC calendar month before the one that contains `at`. */
export function previousMonthPeriod(at: Date): BillingPeriod {
  return monthPeriod(new Date(monthPeriod(at).start.getTime() - 1));
}

/**
 * The share of `period` spent on Pro, counting only time before `until`
 * (now, or the moment of uninstall). `changes` starts with the plan in force
 * at the period start, as `list_vercel_plan_changes` returns it.
 */
export function proShare(
  changes: VercelPlanChangeRow[],
  period: BillingPeriod,
  until: Date = period.end,
): number {
  const stop = Math.min(until.getTime(), period.end.getTime());
  const total = period.end.getTime() - period.start.getTime();
  if (stop <= period.start.getTime() || total <= 0) return 0;

  const ordered = [...changes].sort(
    (a, b) => Date.parse(a.effective_at) - Date.parse(b.effective_at),
  );
  let proMs = 0;
  for (const [index, change] of ordered.entries()) {
    if (change.plan_id !== PRO_PLAN_ID) continue;
    const from = Math.max(Date.parse(change.effective_at), period.start.getTime());
    const next = ordered[index + 1];
    const to = Math.min(next ? Date.parse(next.effective_at) : stop, stop);
    if (to > from) proMs += to - from;
  }
  return Math.min(1, proMs / total);
}

/** USD with two decimals, rounded half up to the cent. */
export function money(amount: number): string {
  return (Math.round(amount * 100 + Number.EPSILON) / 100).toFixed(2);
}

/** The Pro line for a share of a month: quantity in months, total in USD. */
export function proLine(share: number): { quantity: number; total: string } {
  return {
    quantity: Math.round(share * 10_000) / 10_000,
    total: money(PRO_MONTHLY_USD * share),
  };
}

/** One invoice per installation and month, unique as Vercel requires. */
export function externalInvoiceId(installationId: string, period: BillingPeriod): string {
  return `${installationId}:${period.start.toISOString().slice(0, 7)}`;
}

function proItems(share: number): {
  billingPlanId: string;
  name: string;
  price: string;
  quantity: number;
  units: string;
  total: string;
}[] {
  if (share <= 0) return [];
  const line = proLine(share);
  return [
    {
      billingPlanId: PRO_PLAN_ID,
      name: ITEM_NAME,
      price: money(PRO_MONTHLY_USD),
      quantity: line.quantity,
      units: 'month',
      total: line.total,
    },
  ];
}

/** Display-only running total for the Vercel dashboard. Never charges anyone. */
export function interimBillingBody(
  now: Date,
  period: BillingPeriod,
  share: number,
  guardedProjects: number,
): Record<string, unknown> {
  const endOfDay = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1),
  );
  const eod = new Date(Math.min(endOfDay.getTime(), period.end.getTime()));
  return {
    timestamp: now.toISOString(),
    eod: eod.toISOString(),
    period: { start: period.start.toISOString(), end: period.end.toISOString() },
    billing: { items: proItems(share) },
    usage: [
      {
        name: 'Guarded projects',
        type: 'total',
        units: 'projects',
        dayValue: guardedProjects,
        periodValue: guardedProjects,
      },
    ],
  };
}

/**
 * The invoice for a month, or null when nothing is owed. `final` is the last
 * invoice of a deleted installation; Vercel accepts it only while the
 * installation is pending deletion.
 */
export function invoiceBody(
  installationId: string,
  period: BillingPeriod,
  share: number,
  final: boolean,
): Record<string, unknown> | null {
  const items = proItems(share);
  if (items.length === 0 || items[0]?.total === '0.00') return null;
  return {
    externalId: externalInvoiceId(installationId, period),
    // Vercel needs the date inside the period; the last second of it is.
    invoiceDate: new Date(period.end.getTime() - 1000).toISOString(),
    period: { start: period.start.toISOString(), end: period.end.toISOString() },
    items,
    ...(final ? { final: true } : {}),
  };
}
