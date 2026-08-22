import { beforeEach, describe, expect, it, vi } from 'vitest';
import { applyTrialCardReuse, hashTrialCardFingerprint } from './stripeTrialFingerprint';

const mocks = vi.hoisted(() => ({
  paymentMethodsRetrieve: vi.fn(),
  subscriptionsUpdate: vi.fn(),
  claimTrialCardFingerprint: vi.fn(),
}));

const stripe = {
  paymentMethods: { retrieve: mocks.paymentMethodsRetrieve },
  subscriptions: { update: mocks.subscriptionsUpdate },
} as unknown as import('stripe').default;

const db = {
  claimTrialCardFingerprint: mocks.claimTrialCardFingerprint,
};

const billingEvent = {
  eventId: 'evt_1',
  eventType: 'checkout.session.completed',
  organizationId: 'org-a',
  plan: 'pro' as const,
  stripeCustomerId: 'cus_org_a',
  stripeSubscriptionId: 'sub_new',
  stripePriceId: 'price_monthly_server',
};

function trialingSubscription(
  overrides: Record<string, unknown> = {},
): import('stripe').Stripe.Subscription {
  return {
    id: 'sub_new',
    status: 'trialing',
    trial_start: 1,
    customer: 'cus_org_a',
    default_payment_method: 'pm_card',
    ...overrides,
  } as never;
}

describe('hashTrialCardFingerprint', () => {
  it('stores a namespaced sha256, never the raw Stripe fingerprint', () => {
    const hash = hashTrialCardFingerprint('Xt5EWLLDS7FJjR1c');
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    expect(hash).not.toBe('Xt5EWLLDS7FJjR1c');
    expect(hash).toBe(hashTrialCardFingerprint('Xt5EWLLDS7FJjR1c'));
    expect(hash).not.toBe(hashTrialCardFingerprint('other'));
  });
});

describe('applyTrialCardReuse', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.paymentMethodsRetrieve.mockResolvedValue({
      id: 'pm_card',
      card: { fingerprint: 'Xt5EWLLDS7FJjR1c' },
    });
    mocks.claimTrialCardFingerprint.mockResolvedValue(true);
    mocks.subscriptionsUpdate.mockResolvedValue({
      id: 'sub_new',
      status: 'active',
      trial_start: 1,
    });
  });

  it('skips subscriptions that never received a trial', async () => {
    const parsed = {
      billingEvent,
      subscription: trialingSubscription({ trial_start: null }),
    };
    await expect(applyTrialCardReuse(stripe, db, parsed)).resolves.toBe(parsed);
    expect(mocks.claimTrialCardFingerprint).not.toHaveBeenCalled();
    expect(mocks.subscriptionsUpdate).not.toHaveBeenCalled();
  });

  it('skips when Stripe has no card fingerprint (non-card methods)', async () => {
    mocks.paymentMethodsRetrieve.mockResolvedValue({ id: 'pm_sepa', card: null });
    const parsed = { billingEvent, subscription: trialingSubscription() };
    await expect(applyTrialCardReuse(stripe, db, parsed)).resolves.toBe(parsed);
    expect(mocks.claimTrialCardFingerprint).not.toHaveBeenCalled();
  });

  it('keeps the trial when this card fingerprint is claimed first', async () => {
    const parsed = { billingEvent, subscription: trialingSubscription() };
    await expect(applyTrialCardReuse(stripe, db, parsed)).resolves.toBe(parsed);
    expect(mocks.claimTrialCardFingerprint).toHaveBeenCalledWith({
      fingerprintHash: hashTrialCardFingerprint('Xt5EWLLDS7FJjR1c'),
      stripeCustomerId: 'cus_org_a',
      organizationId: 'org-a',
      stripeSubscriptionId: 'sub_new',
    });
    expect(mocks.subscriptionsUpdate).not.toHaveBeenCalled();
  });

  it('ends the trial immediately when the card already used a trial', async () => {
    mocks.claimTrialCardFingerprint.mockResolvedValue(false);
    const parsed = { billingEvent, subscription: trialingSubscription() };

    const result = await applyTrialCardReuse(stripe, db, parsed);

    expect(mocks.subscriptionsUpdate).toHaveBeenCalledWith('sub_new', { trial_end: 'now' });
    expect(result.subscription.status).toBe('active');
    expect(result.billingEvent.plan).toBe('pro');
  });

  it('reads a fingerprint already expanded on the subscription', async () => {
    const parsed = {
      billingEvent,
      subscription: trialingSubscription({
        default_payment_method: {
          id: 'pm_card',
          card: { fingerprint: 'Xt5EWLLDS7FJjR1c' },
        },
      }),
    };
    await applyTrialCardReuse(stripe, db, parsed);
    expect(mocks.paymentMethodsRetrieve).not.toHaveBeenCalled();
    expect(mocks.claimTrialCardFingerprint).toHaveBeenCalledTimes(1);
  });
});
