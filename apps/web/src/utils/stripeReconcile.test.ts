import { beforeEach, describe, expect, it, vi } from 'vitest';
import { reconcileOrganizationBilling } from './stripeReconcile';
import type { Organization } from './dbAdapter';

const mocks = vi.hoisted(() => ({
  subscriptionSearch: vi.fn(),
  processStripeBillingEvent: vi.fn(),
}));

const stripe = {
  subscriptions: { search: mocks.subscriptionSearch },
} as unknown as import('stripe').default;

const db = {
  processStripeBillingEvent: mocks.processStripeBillingEvent,
};

const freeOrg: Organization = {
  id: 'org-a',
  name: 'Acme',
  billing_plan: 'free',
  created_at: '2026-01-01T00:00:00Z',
};

function trialingSub(): Record<string, unknown> {
  return {
    id: 'sub_org_a',
    status: 'trialing',
    created: 10,
    customer: 'cus_org_a',
    items: { data: [{ price: { id: 'price_monthly_server' } }] },
  };
}

describe('reconcileOrganizationBilling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.STRIPE_PRICE_MONTHLY = 'price_monthly_server';
    process.env.STRIPE_PRICE_YEARLY = 'price_yearly_server';
    mocks.subscriptionSearch.mockResolvedValue({ data: [] });
    mocks.processStripeBillingEvent.mockResolvedValue(true);
  });

  it('does not touch OEM workspaces', async () => {
    await reconcileOrganizationBilling(stripe, db as never, {
      ...freeOrg,
      billing_plan: 'oem',
    });
    expect(mocks.subscriptionSearch).not.toHaveBeenCalled();
    expect(mocks.processStripeBillingEvent).not.toHaveBeenCalled();
  });

  it('promotes a free workspace when Stripe reports a trialing subscription', async () => {
    mocks.subscriptionSearch.mockResolvedValue({ data: [trialingSub()] });

    await reconcileOrganizationBilling(stripe, db as never, freeOrg);

    expect(mocks.processStripeBillingEvent).toHaveBeenCalledWith({
      eventId: 'evt_reconcile_orga_suborga_trialing',
      eventType: 'reconcile',
      organizationId: 'org-a',
      plan: 'pro',
      stripeCustomerId: 'cus_org_a',
      stripeSubscriptionId: 'sub_org_a',
      stripePriceId: 'price_monthly_server',
    });
  });

  it('demotes a Pro workspace when Stripe reports a canceled subscription', async () => {
    const canceled = {
      id: 'sub_org_a',
      status: 'canceled',
      created: 10,
      customer: 'cus_org_a',
      items: { data: [{ price: { id: 'price_monthly_server' } }] },
    };
    mocks.subscriptionSearch.mockImplementation(async ({ query }: { query: string }) =>
      query.includes("status:'canceled'") ? { data: [canceled] } : { data: [] },
    );

    await reconcileOrganizationBilling(stripe, db as never, {
      ...freeOrg,
      billing_plan: 'pro',
      stripe_customer_id: 'cus_org_a',
    });

    expect(mocks.processStripeBillingEvent).toHaveBeenCalledWith(
      expect.objectContaining({ plan: 'free', stripeSubscriptionId: 'sub_org_a' }),
    );
  });

  it('is a no-op when Stripe has no subscriptions for the workspace', async () => {
    await reconcileOrganizationBilling(stripe, db as never, freeOrg);
    expect(mocks.processStripeBillingEvent).not.toHaveBeenCalled();
  });
});
