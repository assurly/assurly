import type Stripe from 'stripe';
import type { DbAdapter, Organization } from './dbAdapter';
import { getAllowedStripePriceIds } from './stripe';
import {
  isLiveSubscriptionStatus,
  listLiveOrganizationSubscriptions,
  planForSubscriptionStatus,
  searchOrganizationSubscriptions,
} from './stripeSubscriptions';

const RECONCILE_EVIDENCE_STATUSES: readonly Stripe.Subscription.Status[] = [
  'active',
  'trialing',
  'past_due',
  'unpaid',
  'incomplete',
  'canceled',
  'incomplete_expired',
  'paused',
];

function compactStripeId(value: string): string {
  return value.replace(/[^A-Za-z0-9]/g, '');
}

function reconcileEventId(organizationId: string, subscription: Stripe.Subscription): string {
  return `evt_reconcile_${compactStripeId(organizationId)}_${compactStripeId(subscription.id)}_${subscription.status}`;
}

function subscriptionPriceId(subscription: Stripe.Subscription): string | null {
  const priceIds = subscription.items.data.map((item) => item.price.id);
  if (priceIds.length !== 1 || !getAllowedStripePriceIds().has(priceIds[0])) return null;
  return priceIds[0];
}

function preferLiveSubscription(subscriptions: Stripe.Subscription[]): Stripe.Subscription | null {
  const live = subscriptions.filter((subscription) =>
    isLiveSubscriptionStatus(subscription.status),
  );
  if (live.length > 0) {
    return live.reduce((newest, candidate) =>
      candidate.created > newest.created ? candidate : newest,
    );
  }
  if (subscriptions.length === 0) return null;
  return subscriptions.reduce((newest, candidate) =>
    candidate.created > newest.created ? candidate : newest,
  );
}

function customerIdOf(subscription: Stripe.Subscription): string | null {
  const customer = subscription.customer;
  if (typeof customer === 'string' && customer) return customer;
  if (customer && typeof customer === 'object' && 'id' in customer) return customer.id;
  return null;
}

/**
 * Pull Stripe subscription state into `organizations.billing_plan` so a missing
 * webhook cannot leave the workspace stuck on the wrong plan. OEM is never touched.
 */
export async function reconcileOrganizationBilling(
  stripe: Stripe,
  db: DbAdapter,
  organization: Organization,
): Promise<void> {
  if (organization.billing_plan === 'oem') return;

  const [live, evidence] = await Promise.all([
    listLiveOrganizationSubscriptions(stripe, organization.id),
    searchOrganizationSubscriptions(stripe, organization.id, RECONCILE_EVIDENCE_STATUSES),
  ]);
  const subscription = preferLiveSubscription(live.length > 0 ? live : evidence);
  if (!subscription) return;

  const priceId = subscriptionPriceId(subscription);
  const customerId = customerIdOf(subscription);
  if (!priceId || !customerId) return;

  const plan = planForSubscriptionStatus(subscription.status);
  if (plan === organization.billing_plan && organization.stripe_customer_id === customerId) {
    return;
  }

  await db.processStripeBillingEvent({
    eventId: reconcileEventId(organization.id, subscription),
    eventType: 'reconcile',
    organizationId: organization.id,
    plan,
    stripeCustomerId: customerId,
    stripeSubscriptionId: subscription.id,
    stripePriceId: priceId,
  });
}
