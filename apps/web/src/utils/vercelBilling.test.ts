import { describe, expect, it } from 'vitest';
import {
  externalInvoiceId,
  interimBillingBody,
  invoiceBody,
  money,
  monthPeriod,
  previousMonthPeriod,
  proLine,
  proShare,
} from './vercelBilling';

const OCT = monthPeriod(new Date('2026-10-26T12:00:00Z'));

describe('periods', () => {
  it('is the UTC calendar month', () => {
    expect(OCT.start.toISOString()).toBe('2026-10-01T00:00:00.000Z');
    expect(OCT.end.toISOString()).toBe('2026-11-01T00:00:00.000Z');
  });

  it('the previous month crosses a year', () => {
    const dec = previousMonthPeriod(new Date('2027-01-01T00:30:00Z'));
    expect(dec.start.toISOString()).toBe('2026-12-01T00:00:00.000Z');
    expect(dec.end.toISOString()).toBe('2027-01-01T00:00:00.000Z');
  });

  it('handles February in a leap year', () => {
    const feb = monthPeriod(new Date('2028-02-10T00:00:00Z'));
    expect(feb.end.toISOString()).toBe('2028-03-01T00:00:00.000Z');
  });
});

describe('proShare', () => {
  it('is the whole month on Pro all month', () => {
    expect(proShare([{ plan_id: 'pro', effective_at: '2026-09-01T00:00:00Z' }], OCT)).toBe(1);
  });

  it('is zero on Free', () => {
    expect(proShare([{ plan_id: 'free', effective_at: '2026-09-01T00:00:00Z' }], OCT)).toBe(0);
    expect(proShare([], OCT)).toBe(0);
  });

  it('prorates an upgrade and a downgrade inside the month', () => {
    const share = proShare(
      [
        { plan_id: 'free', effective_at: '2026-09-20T00:00:00Z' },
        { plan_id: 'pro', effective_at: '2026-10-11T00:00:00Z' },
        { plan_id: 'free', effective_at: '2026-10-21T00:00:00Z' },
      ],
      OCT,
    );
    expect(share).toBeCloseTo(10 / 31, 10);
  });

  it('counts only time before `until` (running total, uninstall)', () => {
    const share = proShare(
      [{ plan_id: 'pro', effective_at: '2026-09-01T00:00:00Z' }],
      OCT,
      new Date('2026-10-16T12:00:00Z'),
    );
    expect(share).toBeCloseTo(15.5 / 31, 10);
  });

  it('ignores changes out of order', () => {
    const share = proShare(
      [
        { plan_id: 'free', effective_at: '2026-10-21T00:00:00Z' },
        { plan_id: 'pro', effective_at: '2026-10-11T00:00:00Z' },
      ],
      OCT,
    );
    expect(share).toBeCloseTo(10 / 31, 10);
  });
});

describe('money', () => {
  it('rounds to the cent', () => {
    expect(money(17)).toBe('17.00');
    expect(money(5.483870967)).toBe('5.48');
    expect(money(0.005)).toBe('0.01');
    expect(proLine(10 / 31)).toEqual({ quantity: 0.3226, total: '5.48' });
  });
});

describe('request bodies', () => {
  it('builds the running total with usage', () => {
    const body = interimBillingBody(new Date('2026-10-26T12:00:00Z'), OCT, 1, 3);
    expect(body).toEqual({
      timestamp: '2026-10-26T12:00:00.000Z',
      eod: '2026-10-27T00:00:00.000Z',
      period: { start: '2026-10-01T00:00:00.000Z', end: '2026-11-01T00:00:00.000Z' },
      billing: {
        items: [
          {
            billingPlanId: 'pro',
            name: 'Assurly Live Lock Pro',
            price: '17.00',
            quantity: 1,
            units: 'month',
            total: '17.00',
          },
        ],
      },
      usage: [
        {
          name: 'Guarded projects',
          type: 'total',
          units: 'projects',
          dayValue: 3,
          periodValue: 3,
        },
      ],
    });
  });

  it('keeps eod inside the period on the last day', () => {
    const body = interimBillingBody(new Date('2026-10-31T23:00:00Z'), OCT, 0, 0);
    expect(body.eod).toBe('2026-11-01T00:00:00.000Z');
    expect(body.billing).toEqual({ items: [] });
  });

  it('invoices a month with a date inside it and a unique id', () => {
    expect(invoiceBody('icfg_a', OCT, 1, false)).toEqual({
      externalId: 'icfg_a:2026-10',
      invoiceDate: '2026-10-31T23:59:59.000Z',
      period: { start: '2026-10-01T00:00:00.000Z', end: '2026-11-01T00:00:00.000Z' },
      items: [expect.objectContaining({ total: '17.00', quantity: 1 })],
    });
    expect(invoiceBody('icfg_a', OCT, 0.5, true)).toMatchObject({ final: true });
    expect(externalInvoiceId('icfg_a', OCT)).toBe('icfg_a:2026-10');
  });

  it('sends no invoice when nothing is owed', () => {
    expect(invoiceBody('icfg_a', OCT, 0, false)).toBeNull();
    // Less than half a cent rounds to nothing.
    expect(invoiceBody('icfg_a', OCT, 0.0001, false)).toBeNull();
  });
});
