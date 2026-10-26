import type { DbAdapter, VercelBillingInstallationRow } from './dbAdapter';
import {
  externalInvoiceId,
  interimBillingBody,
  invoiceBody,
  monthPeriod,
  previousMonthPeriod,
  proLine,
  proShare,
  type BillingPeriod,
} from './vercelBilling';
import type { VercelMarketplaceApi } from './vercelMarketplaceApi';

/**
 * The billing run: once per schedule it sends every installation's running
 * total to Vercel and invoices the month that just ended. Each step is safe to
 * repeat. An invoice is recorded before it is sent and sent only from
 * `pending` or `failed`, so a retry never charges anyone twice.
 */

/** A failing invoice is retried on each run, up to this many attempts. */
const MAX_INVOICE_ATTEMPTS = 5;
/** Vercel finalizes a deleted installation 24 hours after deletion. */
const FINAL_INVOICE_WINDOW_MS = 24 * 60 * 60 * 1000;

type BillingApi = Pick<VercelMarketplaceApi, 'submitBillingData' | 'submitInvoice'>;

async function shareFor(
  db: DbAdapter,
  installationId: string,
  period: BillingPeriod,
  until: Date,
): Promise<number> {
  const stop = new Date(Math.min(until.getTime(), period.end.getTime()));
  if (stop <= period.start) return 0;
  const changes = await db.listVercelPlanChanges(
    installationId,
    period.start.toISOString(),
    stop.toISOString(),
  );
  return proShare(changes, period, stop);
}

async function invoicePeriod(
  installationId: string,
  period: BillingPeriod,
  share: number,
  final: boolean,
  api: BillingApi,
  db: DbAdapter,
): Promise<boolean> {
  const body = invoiceBody(installationId, period, share, final);
  if (!body) return true;
  const claim = await db.claimVercelInvoice({
    installationId,
    periodStart: period.start.toISOString(),
    periodEnd: period.end.toISOString(),
    externalId: externalInvoiceId(installationId, period),
    total: proLine(share).total,
    final,
  });
  if (claim.state !== 'pending' && claim.state !== 'failed') return true;
  if (claim.attempts >= MAX_INVOICE_ATTEMPTS) return false;
  try {
    const { invoiceId } = await api.submitInvoice(installationId, body);
    await db.recordVercelInvoiceAttempt(
      installationId,
      period.start.toISOString(),
      invoiceId,
      null,
    );
    return true;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    await db.recordVercelInvoiceAttempt(installationId, period.start.toISOString(), null, reason);
    return false;
  }
}

/**
 * Invoices what is owed up to `until`: the previous month if it has not been
 * invoiced, and for a final settlement (uninstall) the current month too.
 * Returns true when nothing is left to invoice.
 */
export async function settleInstallation(
  installationId: string,
  api: BillingApi,
  db: DbAdapter,
  options: { final: boolean; until: Date },
): Promise<boolean> {
  const previous = previousMonthPeriod(options.until);
  const previousShare = await shareFor(db, installationId, previous, options.until);
  let settled = await invoicePeriod(installationId, previous, previousShare, false, api, db);

  if (options.final) {
    const current = monthPeriod(options.until);
    const currentShare = await shareFor(db, installationId, current, options.until);
    settled =
      (await invoicePeriod(installationId, current, currentShare, true, api, db)) && settled;
  }
  return settled;
}

export interface BillingRunDeps {
  db: DbAdapter;
  decryptToken: (ciphertext: string) => string;
  apiFor: (token: string) => BillingApi;
}

export interface BillingRunReport {
  installations: number;
  reported: number;
  settled: number;
  unsettled: number;
  purged: number;
  failed: number;
}

async function runOne(
  row: VercelBillingInstallationRow,
  now: Date,
  deps: BillingRunDeps,
  report: BillingRunReport,
): Promise<void> {
  const api = deps.apiFor(deps.decryptToken(row.token_ciphertext));

  if (row.deleted_at) {
    const deletedAt = new Date(row.deleted_at);
    // Past Vercel's window the token is gone and no invoice can be sent.
    const settled =
      now.getTime() - deletedAt.getTime() > FINAL_INVOICE_WINDOW_MS ||
      (await settleInstallation(row.installation_id, api, deps.db, {
        final: true,
        until: deletedAt,
      }));
    if (settled) {
      await deps.db.deleteVercelInstallation(row.installation_id);
      report.purged += 1;
    } else {
      report.unsettled += 1;
    }
    return;
  }

  const settled = await settleInstallation(row.installation_id, api, deps.db, {
    final: false,
    until: now,
  });
  report[settled ? 'settled' : 'unsettled'] += 1;

  const period = monthPeriod(now);
  const share = await shareFor(deps.db, row.installation_id, period, now);
  const resources = await deps.db.listLiveLockResources(row.installation_id);
  const guarded = resources.filter((resource) => resource.vercel_project_id).length;
  await api.submitBillingData(row.installation_id, interimBillingBody(now, period, share, guarded));
  report.reported += 1;
}

export async function runVercelBilling(now: Date, deps: BillingRunDeps): Promise<BillingRunReport> {
  const report: BillingRunReport = {
    installations: 0,
    reported: 0,
    settled: 0,
    unsettled: 0,
    purged: 0,
    failed: 0,
  };
  const rows = await deps.db.listVercelInstallationsForBilling();
  for (const row of rows) {
    report.installations += 1;
    try {
      await runOne(row, now, deps, report);
    } catch {
      // One installation never stops the others; it is retried next run.
      report.failed += 1;
    }
  }
  return report;
}
