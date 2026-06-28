import { beforeEach, describe, expect, it, vi } from 'vitest';
import Stripe from 'stripe';
import {
  discoverStripeCustomerForOrganization,
  ensureStripeCustomerForPortal,
  retrieveStripeCustomer,
  verifiedCheckoutCustomerId,
} from './stripeCustomer';

const mocks = vi.hoisted(() => ({
  customerRetrieve: vi.fn(),
  customerSearch: vi.fn(),
  customerList: vi.fn(),
  subscriptionSearch: vi.fn(),
  customerCreate: vi.fn(),
}));

vi.mock('./stripe', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./stripe')>()),
  getStripeClient: () => ({
    customers: {
      retrieve: mocks.customerRetrieve,
      search: mocks.customerSearch,
      list: mocks.customerList,
      create: mocks.customerCreate,
    },
    subscriptions: { search: mocks.subscriptionSearch },
  }),
}));

const stripe = {
  customers: {
    retrieve: mocks.customerRetrieve,
    search: mocks.customerSearch,
    list: mocks.customerList,
    create: mocks.customerCreate,
  },
  subscriptions: { search: mocks.subscriptionSearch },
} as unknown as import('stripe').default;

describe('stripeCustomer reconciliation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.customerSearch.mockResolvedValue({ data: [] });
    mocks.customerList.mockResolvedValue({ data: [] });
    mocks.subscriptionSearch.mockResolvedValue({ data: [] });
  });

  it('returns null for a missing Stripe customer id without throwing', async () => {
    mocks.customerRetrieve.mockRejectedValue(
      new Stripe.errors.StripeInvalidRequestError({
        message: 'No such customer',
        code: 'resource_missing',
        type: 'invalid_request_error',
      }),
    );

    await expect(retrieveStripeCustomer(stripe, 'cus_missing')).resolves.toBeNull();
  });

  it('discovers a customer from active subscription metadata', async () => {
    mocks.subscriptionSearch.mockResolvedValue({
      data: [{ customer: 'cus_live', status: 'active' }],
    });
    mocks.customerRetrieve.mockResolvedValue({
      id: 'cus_live',
      deleted: false,
      metadata: { organizationId: 'org-a' },
    });

    const customer = await discoverStripeCustomerForOrganization(
      stripe,
      'org-a',
      'user@example.com',
    );

    expect(customer?.id).toBe('cus_live');
  });

  it('creates a fresh customer when discovery fails during portal ensure', async () => {
    mocks.customerRetrieve.mockRejectedValue(
      new Stripe.errors.StripeInvalidRequestError({
        message: 'No such customer',
        code: 'resource_missing',
        type: 'invalid_request_error',
      }),
    );
    mocks.customerCreate.mockResolvedValue({
      id: 'cus_new',
      deleted: false,
      metadata: { organizationId: 'org-a' },
    });
    const sync = vi.fn().mockResolvedValue(undefined);

    const customer = await ensureStripeCustomerForPortal(
      stripe,
      {
        id: 'org-a',
        name: 'Acme',
        billing_plan: 'pro',
        stripe_customer_id: 'cus_mock_stale',
        created_at: '2026-01-01T00:00:00Z',
      },
      'user@example.com',
      sync,
    );

    expect(customer.id).toBe('cus_new');
    expect(sync).toHaveBeenCalledWith('org-a', 'cus_new');
  });

  it('ignores stale checkout customer ids so Checkout can use customer_email', async () => {
    mocks.customerRetrieve.mockRejectedValue(
      new Stripe.errors.StripeInvalidRequestError({
        message: 'No such customer',
        code: 'resource_missing',
        type: 'invalid_request_error',
      }),
    );

    await expect(
      verifiedCheckoutCustomerId(stripe, 'cus_mock_stale', 'org-a'),
    ).resolves.toBeUndefined();
  });
});
