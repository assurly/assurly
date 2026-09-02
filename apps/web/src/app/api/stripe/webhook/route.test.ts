import Stripe from 'stripe';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getStripeClient } from '../../../../utils/stripe';
import { POST } from './route';

const mocks = vi.hoisted(() => ({
  getAdminDbAdapter: vi.fn(),
}));

vi.mock('../../../../utils/dbAdapter', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../utils/dbAdapter')>()),
  getAdminDbAdapter: mocks.getAdminDbAdapter,
}));

const db = {
  getOrganization: vi.fn(),
  processStripeBillingEvent: vi.fn(),
  claimTrialCardFingerprint: vi.fn(),
};

function signedRequest(payload: string, timestamp?: number): Request {
  const stripe = getStripeClient();
  const signature = stripe.webhooks.generateTestHeaderString({
    payload,
    secret: process.env.STRIPE_WEBHOOK_SECRET!,
    ...(timestamp === undefined ? {} : { timestamp }),
  });
  return new Request('http://localhost/api/stripe/webhook', {
    method: 'POST',
    headers: { 'stripe-signature': signature },
    body: payload,
  });
}

function checkoutEvent(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    id: 'evt_checkout_1',
    object: 'event',
    api_version: '2026-06-10.clover',
    created: Math.floor(Date.now() / 1000),
    livemode: false,
    pending_webhooks: 1,
    request: null,
    type: 'checkout.session.completed',
    data: {
      object: {
        id: 'cs_test_1',
        object: 'checkout.session',
        ...overrides,
      },
    },
  });
}

function subscriptionEvent(
  type: 'customer.subscription.updated' | 'customer.subscription.deleted',
): string {
  return JSON.stringify({
    id: `evt_${type.replaceAll('.', '_')}`,
    object: 'event',
    api_version: '2026-06-10.clover',
    created: Math.floor(Date.now() / 1000),
    livemode: false,
    pending_webhooks: 1,
    request: null,
    type,
    data: { object: { id: 'sub_org_a', object: 'subscription' } },
  });
}

describe('Stripe webhook security', () => {
  let stripe: Stripe;

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    process.env.STRIPE_SECRET_KEY = 'sk_test_unit_tests';
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_unit_tests';
    process.env.STRIPE_PRICE_MONTHLY = 'price_monthly_server';
    process.env.STRIPE_PRICE_YEARLY = 'price_yearly_server';
    stripe = getStripeClient();
    mocks.getAdminDbAdapter.mockReturnValue(db);
    db.getOrganization.mockReset().mockResolvedValue({ id: 'org-a', stripe_customer_id: null });
    db.processStripeBillingEvent.mockReset().mockResolvedValue(true);
    db.claimTrialCardFingerprint.mockReset().mockResolvedValue(true);

    vi.spyOn(stripe.checkout.sessions, 'retrieve').mockResolvedValue({
      id: 'cs_test_1',
      mode: 'subscription',
      status: 'complete',
      payment_status: 'no_payment_required',
      client_reference_id: 'org-a',
      customer: 'cus_org_a',
      subscription: {
        id: 'sub_org_a',
        status: 'trialing',
        created: 100,
        customer: 'cus_org_a',
        metadata: { organizationId: 'org-a', priceId: 'price_monthly_server' },
        items: { data: [{ price: { id: 'price_monthly_server' } }] },
      },
      metadata: { organizationId: 'org-a', priceId: 'price_monthly_server' },
    } as never);
    vi.spyOn(stripe.customers, 'retrieve').mockResolvedValue({
      id: 'cus_org_a',
      deleted: false,
      metadata: { organizationId: 'org-a' },
    } as never);
    vi.spyOn(stripe.subscriptions, 'search').mockResolvedValue({ data: [] } as never);
    vi.spyOn(stripe.subscriptions, 'cancel').mockResolvedValue({} as never);
  });

  it('fails closed when STRIPE_WEBHOOK_SECRET is absent', async () => {
    delete process.env.STRIPE_WEBHOOK_SECRET;
    const response = await POST(
      new Request('http://localhost/api/stripe/webhook', { method: 'POST', body: '{}' }),
    );
    expect(response.status).toBe(503);
    expect(db.processStripeBillingEvent).not.toHaveBeenCalled();
  });

  it('rejects an unsigned payload', async () => {
    const response = await POST(
      new Request('http://localhost/api/stripe/webhook', {
        method: 'POST',
        body: checkoutEvent(),
      }),
    );
    expect(response.status).toBe(400);
    expect(db.processStripeBillingEvent).not.toHaveBeenCalled();
  });

  it('rejects a signature outside Stripe timestamp tolerance', async () => {
    const response = await POST(
      signedRequest(checkoutEvent(), Math.floor(Date.now() / 1000) - 301),
    );
    expect(response.status).toBe(400);
    expect(db.processStripeBillingEvent).not.toHaveBeenCalled();
  });

  it('applies a signed, fully verified Checkout event', async () => {
    const response = await POST(signedRequest(checkoutEvent()));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ received: true, result: 'processed' });
    expect(db.processStripeBillingEvent).toHaveBeenCalledWith({
      eventId: 'evt_checkout_1',
      eventType: 'checkout.session.completed',
      organizationId: 'org-a',
      plan: 'pro',
      stripeCustomerId: 'cus_org_a',
      stripeSubscriptionId: 'sub_org_a',
      stripePriceId: 'price_monthly_server',
    });
  });

  it('treats a duplicate event as a no-op', async () => {
    db.processStripeBillingEvent.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    const payload = checkoutEvent();

    const first = await POST(signedRequest(payload));
    const duplicate = await POST(signedRequest(payload));

    expect((await first.json()).result).toBe('processed');
    expect((await duplicate.json()).result).toBe('duplicate');
    expect(db.processStripeBillingEvent).toHaveBeenCalledTimes(2);
  });

  it('rejects an unknown organization before billing mutation', async () => {
    db.getOrganization.mockResolvedValue(null);
    const response = await POST(signedRequest(checkoutEvent()));
    expect(response.status).toBe(400);
    expect(db.processStripeBillingEvent).not.toHaveBeenCalled();
  });

  it('rejects a tenant-foreign Stripe customer before billing mutation', async () => {
    db.getOrganization.mockResolvedValue({
      id: 'org-a',
      stripe_customer_id: 'cus_org_b',
    });
    const response = await POST(signedRequest(checkoutEvent()));
    expect(response.status).toBe(400);
    expect(db.processStripeBillingEvent).not.toHaveBeenCalled();
  });

  it('rejects an unpaid Checkout Session', async () => {
    vi.mocked(stripe.checkout.sessions.retrieve).mockResolvedValueOnce({
      id: 'cs_test_1',
      mode: 'subscription',
      status: 'complete',
      payment_status: 'unpaid',
    } as never);
    const response = await POST(signedRequest(checkoutEvent()));
    expect(response.status).toBe(400);
    expect(db.processStripeBillingEvent).not.toHaveBeenCalled();
  });

  it('rejects a subscription using a non-server price', async () => {
    vi.mocked(stripe.checkout.sessions.retrieve).mockResolvedValueOnce({
      id: 'cs_test_1',
      mode: 'subscription',
      status: 'complete',
      payment_status: 'paid',
      client_reference_id: 'org-a',
      customer: 'cus_org_a',
      subscription: {
        id: 'sub_org_a',
        status: 'active',
        customer: 'cus_org_a',
        metadata: { organizationId: 'org-a', priceId: 'price_attacker' },
        items: { data: [{ price: { id: 'price_attacker' } }] },
      },
      metadata: { organizationId: 'org-a', priceId: 'price_attacker' },
    } as never);
    const response = await POST(signedRequest(checkoutEvent()));
    expect(response.status).toBe(400);
    expect(db.processStripeBillingEvent).not.toHaveBeenCalled();
  });

  it('keeps Pro while Stripe is retrying a past-due subscription', async () => {
    vi.spyOn(stripe.subscriptions, 'retrieve').mockResolvedValue({
      id: 'sub_org_a',
      status: 'past_due',
      customer: 'cus_org_a',
      metadata: { organizationId: 'org-a', priceId: 'price_monthly_server' },
      items: { data: [{ price: { id: 'price_monthly_server' } }] },
    } as never);

    const response = await POST(signedRequest(subscriptionEvent('customer.subscription.updated')));
    expect(response.status).toBe(200);
    expect(db.processStripeBillingEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        plan: 'pro',
        stripeCustomerId: 'cus_org_a',
        stripeSubscriptionId: 'sub_org_a',
      }),
    );
  });

  it('rejects a deleted event unless Stripe confirms canceled status', async () => {
    vi.spyOn(stripe.subscriptions, 'retrieve').mockResolvedValue({
      id: 'sub_org_a',
      status: 'active',
      customer: 'cus_org_a',
      metadata: { organizationId: 'org-a', priceId: 'price_monthly_server' },
      items: { data: [{ price: { id: 'price_monthly_server' } }] },
    } as never);

    const response = await POST(signedRequest(subscriptionEvent('customer.subscription.deleted')));
    expect(response.status).toBe(400);
    expect(db.processStripeBillingEvent).not.toHaveBeenCalled();
  });

  it('acknowledges foreign-account events that have no Assurly organization metadata', async () => {
    vi.mocked(stripe.checkout.sessions.retrieve).mockResolvedValueOnce({
      id: 'cs_clipsmart',
      mode: 'subscription',
      status: 'complete',
      payment_status: 'paid',
      client_reference_id: '3145349',
      customer: 'cus_other',
      subscription: 'sub_other',
      metadata: {},
    } as never);

    const response = await POST(signedRequest(checkoutEvent()));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ received: true, result: 'ignored' });
    expect(db.processStripeBillingEvent).not.toHaveBeenCalled();
  });

  it('ignores billing mutations for an OEM workspace', async () => {
    db.getOrganization.mockResolvedValue({
      id: 'org-a',
      billing_plan: 'oem',
      stripe_customer_id: 'cus_org_a',
    });

    const response = await POST(signedRequest(checkoutEvent()));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ received: true, result: 'ignored' });
    expect(db.processStripeBillingEvent).not.toHaveBeenCalled();
  });

  it('cancels a newer duplicate subscription and does not apply it', async () => {
    vi.mocked(stripe.subscriptions.search).mockResolvedValue({
      data: [
        {
          id: 'sub_older',
          status: 'trialing',
          created: 1,
          customer: 'cus_org_a',
        },
      ],
    } as never);

    const response = await POST(signedRequest(checkoutEvent()));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ received: true, result: 'ignored' });
    expect(stripe.subscriptions.cancel).toHaveBeenCalledWith('sub_org_a');
    expect(db.processStripeBillingEvent).not.toHaveBeenCalled();
  });

  it('maps invoice.payment_failed onto the subscription plan', async () => {
    vi.spyOn(stripe.subscriptions, 'retrieve').mockResolvedValue({
      id: 'sub_org_a',
      status: 'past_due',
      customer: 'cus_org_a',
      metadata: { organizationId: 'org-a', priceId: 'price_monthly_server' },
      items: { data: [{ price: { id: 'price_monthly_server' } }] },
    } as never);

    const payload = JSON.stringify({
      id: 'evt_invoice_payment_failed',
      object: 'event',
      api_version: '2026-06-10.clover',
      created: Math.floor(Date.now() / 1000),
      livemode: false,
      pending_webhooks: 1,
      request: null,
      type: 'invoice.payment_failed',
      data: {
        object: {
          id: 'in_org_a',
          object: 'invoice',
          parent: {
            type: 'subscription_details',
            subscription_details: { subscription: 'sub_org_a' },
            quote_details: null,
          },
        },
      },
    });

    const response = await POST(signedRequest(payload));
    expect(response.status).toBe(200);
    expect(db.processStripeBillingEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'invoice.payment_failed',
        plan: 'pro',
        stripeSubscriptionId: 'sub_org_a',
      }),
    );
  });

  it('ends a trial immediately when the card fingerprint was already used', async () => {
    db.claimTrialCardFingerprint.mockResolvedValue(false);
    vi.spyOn(stripe.checkout.sessions, 'retrieve').mockResolvedValue({
      id: 'cs_test_1',
      mode: 'subscription',
      status: 'complete',
      payment_status: 'no_payment_required',
      client_reference_id: 'org-a',
      customer: 'cus_org_a',
      subscription: {
        id: 'sub_org_a',
        status: 'trialing',
        trial_start: 1,
        created: 100,
        customer: 'cus_org_a',
        default_payment_method: 'pm_card',
        metadata: { organizationId: 'org-a', priceId: 'price_monthly_server' },
        items: { data: [{ price: { id: 'price_monthly_server' } }] },
      },
      metadata: { organizationId: 'org-a', priceId: 'price_monthly_server' },
    } as never);
    vi.spyOn(stripe.paymentMethods, 'retrieve').mockResolvedValue({
      id: 'pm_card',
      card: { fingerprint: 'Xt5EWLLDS7FJjR1c' },
    } as never);
    vi.spyOn(stripe.subscriptions, 'update').mockResolvedValue({
      id: 'sub_org_a',
      status: 'active',
      trial_start: 1,
      customer: 'cus_org_a',
      metadata: { organizationId: 'org-a', priceId: 'price_monthly_server' },
      items: { data: [{ price: { id: 'price_monthly_server' } }] },
    } as never);

    const response = await POST(signedRequest(checkoutEvent()));

    expect(response.status).toBe(200);
    expect(stripe.subscriptions.update).toHaveBeenCalledWith('sub_org_a', { trial_end: 'now' });
    expect(db.processStripeBillingEvent).toHaveBeenCalledWith(
      expect.objectContaining({ plan: 'pro', stripeSubscriptionId: 'sub_org_a' }),
    );
  });
});
