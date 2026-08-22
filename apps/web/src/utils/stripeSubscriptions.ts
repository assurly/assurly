import type Stripe from 'stripe';

/** Statuses that mean the workspace already has a live (or in-flight) subscription. */
export const BLOCKING_SUBSCRIPTION_STATUSES = [
  'active',
  'trialing',
  'past_due',
  'unpaid',
  'incomplete',
] as const satisfies readonly Stripe.Subscription.Status[];

export type BlockingSubscriptionStatus = (typeof BLOCKING_SUBSCRIPTION_STATUSES)[number];

/** Statuses that keep Pro entitlements, including Stripe's payment-retry window. */
const LIVE_SUBSCRIPTION_STATUSES = [
  'active',
  'trialing',
  'past_due',
] as const satisfies readonly Stripe.Subscription.Status[];

export type LiveSubscriptionStatus = (typeof LIVE_SUBSCRIPTION_STATUSES)[number];

/** Stripe Search interpolation must stay alphanumeric — org ids are UUIDs or test fixtures. */
const SAFE_STRIPE_SEARCH_ID = /^[A-Za-z0-9_-]{1,64}$/;

export function requireSafeStripeSearchId(organizationId: string): string {
  if (!SAFE_STRIPE_SEARCH_ID.test(organizationId)) {
    throw new Error('Organization id is not safe for Stripe search.');
  }
  return organizationId;
}

export function planForSubscriptionStatus(status: Stripe.Subscription.Status): 'free' | 'pro' {
  switch (status) {
    case 'active':
    case 'trialing':
    case 'past_due':
      return 'pro';
    case 'canceled':
    case 'incomplete':
    case 'incomplete_expired':
    case 'paused':
    case 'unpaid':
      return 'free';
    default: {
      const exhaustive: never = status;
      throw new Error(`Unknown subscription status: ${String(exhaustive)}`);
    }
  }
}

export function isBlockingSubscriptionStatus(
  status: Stripe.Subscription.Status,
): status is BlockingSubscriptionStatus {
  switch (status) {
    case 'active':
    case 'trialing':
    case 'past_due':
    case 'unpaid':
    case 'incomplete':
      return true;
    case 'canceled':
    case 'incomplete_expired':
    case 'paused':
      return false;
    default: {
      const exhaustive: never = status;
      throw new Error(`Unknown subscription status: ${String(exhaustive)}`);
    }
  }
}

export function isLiveSubscriptionStatus(
  status: Stripe.Subscription.Status,
): status is LiveSubscriptionStatus {
  return status === 'active' || status === 'trialing' || status === 'past_due';
}

export function subscriptionUsedTrial(
  subscription: Pick<Stripe.Subscription, 'trial_start'>,
): boolean {
  return subscription.trial_start != null;
}

function dedupeSubscriptions(subscriptions: Stripe.Subscription[]): Stripe.Subscription[] {
  const byId = new Map<string, Stripe.Subscription>();
  for (const subscription of subscriptions) {
    byId.set(subscription.id, subscription);
  }
  return [...byId.values()];
}

export async function listCustomerSubscriptions(
  stripe: Stripe,
  customerId: string,
): Promise<Stripe.Subscription[]> {
  const page = await stripe.subscriptions.list({
    customer: customerId,
    status: 'all',
    limit: 100,
  });
  return page.data;
}

export async function searchOrganizationSubscriptions(
  stripe: Stripe,
  organizationId: string,
  statuses: readonly Stripe.Subscription.Status[],
): Promise<Stripe.Subscription[]> {
  const safeId = requireSafeStripeSearchId(organizationId);
  const pages = await Promise.all(
    statuses.map((status) =>
      stripe.subscriptions.search({
        query: `metadata['organizationId']:'${safeId}' status:'${status}'`,
        limit: 100,
      }),
    ),
  );
  return dedupeSubscriptions(pages.flatMap((page) => page.data));
}

export async function listLiveOrganizationSubscriptions(
  stripe: Stripe,
  organizationId: string,
): Promise<Stripe.Subscription[]> {
  return searchOrganizationSubscriptions(stripe, organizationId, LIVE_SUBSCRIPTION_STATUSES);
}

export async function collectOrganizationSubscriptions(
  stripe: Stripe,
  organizationId: string,
  customerId: string,
): Promise<Stripe.Subscription[]> {
  const [byCustomer, blockingForOrg] = await Promise.all([
    listCustomerSubscriptions(stripe, customerId),
    searchOrganizationSubscriptions(stripe, organizationId, BLOCKING_SUBSCRIPTION_STATUSES),
  ]);
  return dedupeSubscriptions([...byCustomer, ...blockingForOrg]);
}

export function oldestSubscription(subscriptions: Stripe.Subscription[]): Stripe.Subscription {
  return subscriptions.reduce((oldest, candidate) =>
    candidate.created < oldest.created ? candidate : oldest,
  );
}
