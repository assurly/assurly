import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  DbAdapter,
  LiveLockResourceRow,
  VercelBillingInstallationRow,
  VercelInvoiceState,
  VercelPlanChangeRow,
} from './dbAdapter';
import { runVercelBilling, type BillingRunDeps } from './vercelBillingRun';

const NOW = new Date('2026-11-01T02:00:00Z');

function row(overrides: Partial<VercelBillingInstallationRow> = {}): VercelBillingInstallationRow {
  return {
    installation_id: 'icfg_a',
    token_ciphertext: 'cipher',
    billing_plan_id: 'pro',
    billing_status: 'ok',
    deleted_at: null,
    created_at: '2026-09-01T00:00:00Z',
    ...overrides,
  };
}

function setup() {
  const db = {
    listVercelInstallationsForBilling: vi.fn(
      async (): Promise<VercelBillingInstallationRow[]> => [row()],
    ),
    listVercelPlanChanges: vi.fn(
      async (): Promise<VercelPlanChangeRow[]> => [
        { plan_id: 'pro', effective_at: '2026-09-01T00:00:00Z' },
      ],
    ),
    claimVercelInvoice: vi.fn(
      async (): Promise<{
        state: VercelInvoiceState;
        vercel_invoice_id: string | null;
        attempts: number;
      }> => ({ state: 'pending', vercel_invoice_id: null, attempts: 0 }),
    ),
    recordVercelInvoiceAttempt: vi.fn(async () => undefined),
    deleteVercelInstallation: vi.fn(async () => 'org-1'),
    listLiveLockResources: vi.fn(
      async () =>
        [
          { vercel_project_id: 'prj_1' },
          { vercel_project_id: null },
        ] as unknown as LiveLockResourceRow[],
    ),
  };
  const api = {
    submitBillingData: vi.fn(async () => undefined),
    submitInvoice: vi.fn(async () => ({ invoiceId: 'inv_1' })),
  };
  const deps: BillingRunDeps = {
    db: db as unknown as DbAdapter,
    decryptToken: (cipher) => `dec:${cipher}`,
    apiFor: vi.fn(() => api),
  };
  return { db, api, deps };
}

describe('runVercelBilling', () => {
  let ctx: ReturnType<typeof setup>;
  beforeEach(() => {
    ctx = setup();
  });

  it('invoices the month that ended and reports the new one', async () => {
    const report = await runVercelBilling(NOW, ctx.deps);
    expect(ctx.db.claimVercelInvoice).toHaveBeenCalledWith({
      installationId: 'icfg_a',
      periodStart: '2026-10-01T00:00:00.000Z',
      periodEnd: '2026-11-01T00:00:00.000Z',
      externalId: 'icfg_a:2026-10',
      total: '17.00',
      final: false,
    });
    expect(ctx.api.submitInvoice).toHaveBeenCalledWith(
      'icfg_a',
      expect.objectContaining({ externalId: 'icfg_a:2026-10' }),
    );
    expect(ctx.db.recordVercelInvoiceAttempt).toHaveBeenCalledWith(
      'icfg_a',
      '2026-10-01T00:00:00.000Z',
      'inv_1',
      null,
    );
    const [, interim] = ctx.api.submitBillingData.mock.calls[0] as unknown as [
      string,
      { period: { start: string }; usage: { periodValue: number }[] },
    ];
    expect(interim.period.start).toBe('2026-11-01T00:00:00.000Z');
    expect(interim.usage[0]?.periodValue).toBe(1);
    expect(report).toMatchObject({ installations: 1, reported: 1, settled: 1, failed: 0 });
  });

  it('never sends an invoice twice', async () => {
    ctx.db.claimVercelInvoice.mockResolvedValue({
      state: 'submitted',
      vercel_invoice_id: 'inv_1',
      attempts: 1,
    });
    await runVercelBilling(NOW, ctx.deps);
    expect(ctx.api.submitInvoice).not.toHaveBeenCalled();
    expect(ctx.api.submitBillingData).toHaveBeenCalledTimes(1);
  });

  it('records a failed invoice and retries it on the next run, up to a limit', async () => {
    ctx.api.submitInvoice.mockRejectedValueOnce(new Error('Vercel invoice submit failed (503).'));
    const first = await runVercelBilling(NOW, ctx.deps);
    expect(ctx.db.recordVercelInvoiceAttempt).toHaveBeenCalledWith(
      'icfg_a',
      '2026-10-01T00:00:00.000Z',
      null,
      'Vercel invoice submit failed (503).',
    );
    expect(first.unsettled).toBe(1);

    ctx.db.claimVercelInvoice.mockResolvedValue({
      state: 'failed',
      vercel_invoice_id: null,
      attempts: 5,
    });
    ctx.api.submitInvoice.mockClear();
    await runVercelBilling(NOW, ctx.deps);
    expect(ctx.api.submitInvoice).not.toHaveBeenCalled();
  });

  it('a Free installation gets a zero running total and no invoice', async () => {
    ctx.db.listVercelPlanChanges.mockResolvedValue([
      { plan_id: 'free', effective_at: '2026-09-01T00:00:00Z' },
    ]);
    await runVercelBilling(NOW, ctx.deps);
    expect(ctx.db.claimVercelInvoice).not.toHaveBeenCalled();
    expect(ctx.api.submitBillingData).toHaveBeenCalledWith(
      'icfg_a',
      expect.objectContaining({ billing: { items: [] } }),
    );
  });

  it('settles a deleted installation with a final invoice, then purges it', async () => {
    ctx.db.listVercelInstallationsForBilling.mockResolvedValue([
      row({ deleted_at: '2026-10-31T12:00:00Z' }),
    ]);
    const report = await runVercelBilling(NOW, ctx.deps);
    expect(ctx.db.claimVercelInvoice).toHaveBeenCalledWith(
      expect.objectContaining({ final: true, periodStart: '2026-10-01T00:00:00.000Z' }),
    );
    expect(ctx.api.submitInvoice).toHaveBeenCalledWith(
      'icfg_a',
      expect.objectContaining({ final: true }),
    );
    expect(ctx.api.submitBillingData).not.toHaveBeenCalled();
    expect(ctx.db.deleteVercelInstallation).toHaveBeenCalledWith('icfg_a');
    expect(report.purged).toBe(1);
  });

  it('purges a deleted installation past Vercel’s 24 hours without invoicing', async () => {
    ctx.db.listVercelInstallationsForBilling.mockResolvedValue([
      row({ deleted_at: '2026-10-29T00:00:00Z' }),
    ]);
    await runVercelBilling(NOW, ctx.deps);
    expect(ctx.api.submitInvoice).not.toHaveBeenCalled();
    expect(ctx.db.deleteVercelInstallation).toHaveBeenCalledWith('icfg_a');
  });

  it('one failing installation does not stop the others', async () => {
    ctx.db.listVercelInstallationsForBilling.mockResolvedValue([
      row({ installation_id: 'icfg_a' }),
      row({ installation_id: 'icfg_b' }),
    ]);
    ctx.api.submitBillingData.mockRejectedValueOnce(new Error('down'));
    const report = await runVercelBilling(NOW, ctx.deps);
    expect(report).toMatchObject({ installations: 2, failed: 1, reported: 1 });
  });
});
