import { beforeEach, describe, expect, it, vi } from 'vitest';
import Stripe from 'stripe';
import {
  discoverStripeCustomerForOrganization,
  ensureStripeCustomer,
  retrieveStripeCustomer,
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

  it('creates a fresh customer when discovery fails', async () => {
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

    const customer = await ensureStripeCustomer(
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

  it('reuses the winner when persisting a customer hits a unique conflict', async () => {
    mocks.customerRetrieve.mockResolvedValue({
      id: 'cus_winner',
      deleted: false,
      metadata: { organizationId: 'org-a' },
    });
    mocks.customerCreate.mockResolvedValue({
      id: 'cus_loser',
      deleted: false,
      metadata: { organizationId: 'org-a' },
    });
    const sync = vi.fn().mockRejectedValue(new Error('Supabase request failed (409): duplicate'));
    const reload = vi.fn().mockResolvedValue({
      id: 'org-a',
      stripe_customer_id: 'cus_winner',
    });

    const customer = await ensureStripeCustomer(
      stripe,
      {
        id: 'org-a',
        name: 'Acme',
        billing_plan: 'free',
        created_at: '2026-01-01T00:00:00Z',
      },
      'user@example.com',
      sync,
      reload,
    );

    expect(customer.id).toBe('cus_winner');
  });
});
