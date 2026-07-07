import { beforeEach, describe, expect, it, vi } from 'vitest';
import Stripe from 'stripe';
import { POST as checkout } from './stripe/checkout/route';
import { POST as portal } from './stripe/portal/route';

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  checkoutCreate: vi.fn(),
  customerRetrieve: vi.fn(),
  customerCreate: vi.fn(),
  customerSearch: vi.fn(),
  customerList: vi.fn(),
  subscriptionSearch: vi.fn(),
  portalCreate: vi.fn(),
  setOrganizationStripeCustomerId: vi.fn(),
  getAdminDbAdapter: vi.fn(),
}));

vi.mock('../../utils/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../utils/auth')>()),
  requireUser: mocks.requireUser,
}));

vi.mock('../../utils/dbAdapter', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../utils/dbAdapter')>()),
  getAdminDbAdapter: mocks.getAdminDbAdapter,
}));

vi.mock('../../utils/stripe', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../utils/stripe')>()),
  getAppUrl: () => 'https://app.assurly.example',
  getStripePriceId: (plan: string) =>
    plan === 'yearly' ? 'price_yearly_server' : 'price_monthly_server',
  getStripeClient: () => ({
    checkout: { sessions: { create: mocks.checkoutCreate } },
    customers: {
      retrieve: mocks.customerRetrieve,
      create: mocks.customerCreate,
      search: mocks.customerSearch,
      list: mocks.customerList,
    },
    subscriptions: { search: mocks.subscriptionSearch },
    billingPortal: { sessions: { create: mocks.portalCreate } },
  }),
}));

const db = {
  getOrganizationByUserId: vi.fn(),
  getOrganization: vi.fn(),
  getMembership: vi.fn(),
};

describe('billing API ownership and request safety', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireUser.mockResolvedValue({
      user: { id: 'user-a', name: 'A', email: 'a@example.com', avatar_url: '' },
      accessToken: 'verified',
      db,
    });
    db.getOrganizationByUserId.mockResolvedValue({
      id: 'org-a',
      name: 'Acme',
      billing_plan: 'free',
    });
    db.getOrganization.mockResolvedValue({ id: 'org-a', billing_plan: 'free' });
    db.getMembership.mockResolvedValue({
      user_id: 'user-a',
      organization_id: 'org-a',
    });
    mocks.checkoutCreate.mockResolvedValue({ url: 'https://checkout.stripe.com/c/pay/test' });
    mocks.portalCreate.mockResolvedValue({ url: 'https://billing.stripe.com/p/session/test' });
    mocks.getAdminDbAdapter.mockReturnValue({
      setOrganizationStripeCustomerId: mocks.setOrganizationStripeCustomerId,
    });
    mocks.customerSearch.mockResolvedValue({ data: [] });
    mocks.customerList.mockResolvedValue({ data: [] });
    mocks.subscriptionSearch.mockResolvedValue({ data: [] });
    mocks.setOrganizationStripeCustomerId.mockResolvedValue(undefined);
  });

  it('uses a server price and fixed APP_URL for Checkout', async () => {
    const response = await checkout(
      new Request('https://attacker.example/api/stripe/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Host: 'attacker.example' },
        body: JSON.stringify({ plan: 'yearly' }),
      }),
    );

    expect(response.status).toBe(200);
    expect(mocks.checkoutCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: 'subscription',
        success_url: 'https://app.assurly.example/dashboard?success=stripe_upgrade',
        cancel_url: 'https://app.assurly.example/dashboard?cancel=stripe_cancelled',
        client_reference_id: 'org-a',
        line_items: [{ price: 'price_yearly_server', quantity: 1 }],
      }),
    );
  });

  it('rejects an arbitrary client-side price or plan', async () => {
    const response = await checkout(
      new Request('http://localhost/api/stripe/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan: 'price_attacker_controlled' }),
      }),
    );

    expect(response.status).toBe(400);
    expect(mocks.checkoutCreate).not.toHaveBeenCalled();
  });

  it('refuses Checkout when membership disappears', async () => {
    db.getMembership.mockResolvedValue(null);
    const response = await checkout(
      new Request('http://localhost/api/stripe/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan: 'monthly' }),
      }),
    );
    expect(response.status).toBe(404);
    expect(mocks.checkoutCreate).not.toHaveBeenCalled();
  });

  it('verifies the stored customer and uses POST portal with fixed APP_URL', async () => {
    db.getOrganizationByUserId.mockResolvedValue({
      id: 'org-a',
      name: 'Acme',
      billing_plan: 'pro',
      stripe_customer_id: 'cus_org_a',
    });
    mocks.customerRetrieve.mockResolvedValue({
      id: 'cus_org_a',
      deleted: false,
      metadata: { organizationId: 'org-a' },
    });

    const response = await portal(
      new Request('https://attacker.example/api/stripe/portal', { method: 'POST' }),
    );

    expect(response.status).toBe(200);
    expect(mocks.portalCreate).toHaveBeenCalledWith({
      customer: 'cus_org_a',
      return_url: 'https://app.assurly.example/dashboard',
    });
    expect(mocks.customerCreate).not.toHaveBeenCalled();
  });

  it('does not open a portal for a foreign customer', async () => {
    db.getOrganizationByUserId.mockResolvedValue({
      id: 'org-a',
      name: 'Acme',
      billing_plan: 'pro',
      stripe_customer_id: 'cus_foreign',
    });
    mocks.customerRetrieve.mockResolvedValue({
      id: 'cus_foreign',
      deleted: false,
      metadata: { organizationId: 'org-b' },
    });

    const response = await portal(
      new Request('http://localhost/api/stripe/portal', { method: 'POST' }),
    );
    expect(response.status).toBe(404);
    expect(mocks.portalCreate).not.toHaveBeenCalled();
  });

  it('reconciles a stale stored customer by creating a live Stripe customer and opens the portal', async () => {
    db.getOrganizationByUserId.mockResolvedValue({
      id: 'org-a',
      name: 'Acme',
      billing_plan: 'pro',
      stripe_customer_id: 'cus_mock_stale',
    });
    mocks.customerRetrieve.mockRejectedValue(
      new Stripe.errors.StripeInvalidRequestError({
        message: 'No such customer',
        code: 'resource_missing',
        type: 'invalid_request_error',
      }),
    );
    mocks.customerCreate.mockResolvedValue({
      id: 'cus_reconciled',
      deleted: false,
      metadata: { organizationId: 'org-a' },
    });

    const response = await portal(
      new Request('http://localhost/api/stripe/portal', { method: 'POST' }),
    );

    expect(response.status).toBe(200);
    expect(mocks.customerCreate).toHaveBeenCalledWith({
      email: 'a@example.com',
      name: 'Acme',
      metadata: { organizationId: 'org-a' },
    });
    expect(mocks.setOrganizationStripeCustomerId).toHaveBeenCalledWith('org-a', 'cus_reconciled');
    expect(mocks.portalCreate).toHaveBeenCalledWith({
      customer: 'cus_reconciled',
      return_url: 'https://app.assurly.example/dashboard',
    });
  });

  it('rediscovers a live Stripe customer from subscription metadata when the stored id is stale', async () => {
    db.getOrganizationByUserId.mockResolvedValue({
      id: 'org-a',
      name: 'Acme',
      billing_plan: 'pro',
      stripe_customer_id: 'cus_mock_stale',
    });
    mocks.customerRetrieve
      .mockRejectedValueOnce(
        new Stripe.errors.StripeInvalidRequestError({
          message: 'No such customer',
          code: 'resource_missing',
          type: 'invalid_request_error',
        }),
      )
      .mockResolvedValueOnce({
        id: 'cus_live',
        deleted: false,
        metadata: { organizationId: 'org-a' },
      });
    mocks.subscriptionSearch.mockResolvedValue({
      data: [{ customer: 'cus_live', status: 'active' }],
    });

    const response = await portal(
      new Request('http://localhost/api/stripe/portal', { method: 'POST' }),
    );

    expect(response.status).toBe(200);
    expect(mocks.customerCreate).not.toHaveBeenCalled();
    expect(mocks.setOrganizationStripeCustomerId).toHaveBeenCalledWith('org-a', 'cus_live');
    expect(mocks.portalCreate).toHaveBeenCalledWith({
      customer: 'cus_live',
      return_url: 'https://app.assurly.example/dashboard',
    });
  });

  it('falls back to customer_email Checkout when the stored Stripe customer no longer exists', async () => {
    db.getOrganizationByUserId.mockResolvedValue({
      id: 'org-a',
      name: 'Acme',
      billing_plan: 'pro',
      stripe_customer_id: 'cus_missing',
    });
    mocks.customerRetrieve.mockRejectedValue(
      new Stripe.errors.StripeInvalidRequestError({
        message: 'No such customer',
        code: 'resource_missing',
        type: 'invalid_request_error',
      }),
    );

    const response = await checkout(
      new Request('http://localhost/api/stripe/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan: 'monthly' }),
      }),
    );

    expect(response.status).toBe(200);
    expect(mocks.checkoutCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        customer_email: 'a@example.com',
      }),
    );
    expect(mocks.checkoutCreate).not.toHaveBeenCalledWith(
      expect.objectContaining({ customer: 'cus_missing' }),
    );
  });
});
