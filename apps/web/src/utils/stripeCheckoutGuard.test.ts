import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from './apiSecurity';
import { PRO_TRIAL_PERIOD_DAYS } from './pricing';
import { evaluateCheckoutEligibility } from './stripeCheckoutGuard';

const mocks = vi.hoisted(() => ({
  sessionList: vi.fn(),
  sessionExpire: vi.fn(),
  subscriptionList: vi.fn(),
  subscriptionSearch: vi.fn(),
  customerList: vi.fn(),
}));

const stripe = {
  checkout: {
    sessions: { list: mocks.sessionList, expire: mocks.sessionExpire },
  },
  subscriptions: { list: mocks.subscriptionList, search: mocks.subscriptionSearch },
  customers: { list: mocks.customerList },
} as unknown as import('stripe').default;

describe('evaluateCheckoutEligibility', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.sessionList.mockResolvedValue({ data: [] });
    mocks.sessionExpire.mockResolvedValue({});
    mocks.subscriptionList.mockResolvedValue({ data: [] });
    mocks.subscriptionSearch.mockResolvedValue({ data: [] });
    mocks.customerList.mockResolvedValue({ data: [] });
  });

  it('grants a 3-day trial when the customer has no subscription history', async () => {
    await expect(
      evaluateCheckoutEligibility(stripe, 'org-a', 'cus_new', 'a@example.com'),
    ).resolves.toEqual({ trialPeriodDays: PRO_TRIAL_PERIOD_DAYS });
  });

  it('expires open Checkout Sessions before evaluating eligibility', async () => {
    mocks.sessionList.mockResolvedValue({ data: [{ id: 'cs_open_1' }, { id: 'cs_open_2' }] });

    await evaluateCheckoutEligibility(stripe, 'org-a', 'cus_new', 'a@example.com');

    expect(mocks.sessionExpire).toHaveBeenCalledWith('cs_open_1');
    expect(mocks.sessionExpire).toHaveBeenCalledWith('cs_open_2');
  });

  it('skips the trial when this customer already used one', async () => {
    mocks.subscriptionList.mockResolvedValue({
      data: [{ id: 'sub_old', status: 'canceled', trial_start: 1_700_000_000, created: 1 }],
    });

    await expect(
      evaluateCheckoutEligibility(stripe, 'org-a', 'cus_old', 'a@example.com'),
    ).resolves.toEqual({ trialPeriodDays: null });
  });

  it('skips the trial when another customer with the same email already used one', async () => {
    mocks.customerList.mockResolvedValue({
      data: [{ id: 'cus_other', metadata: {} }],
    });
    mocks.subscriptionList.mockResolvedValueOnce({ data: [] }).mockResolvedValueOnce({
      data: [{ id: 'sub_email', status: 'canceled', trial_start: 1_700_000_000, created: 1 }],
    });

    await expect(
      evaluateCheckoutEligibility(stripe, 'org-a', 'cus_new', 'a@example.com'),
    ).resolves.toEqual({ trialPeriodDays: null });
  });

  it.each(['active', 'trialing', 'past_due', 'unpaid', 'incomplete'] as const)(
    'rejects checkout when a %s subscription already exists',
    async (status) => {
      mocks.subscriptionList.mockResolvedValue({
        data: [{ id: 'sub_live', status, created: 1 }],
      });

      await expect(
        evaluateCheckoutEligibility(stripe, 'org-a', 'cus_org_a', 'a@example.com'),
      ).rejects.toMatchObject({
        name: 'ApiError',
        status: 409,
        code: 'already_subscribed',
      } satisfies Partial<ApiError>);
    },
  );
});
