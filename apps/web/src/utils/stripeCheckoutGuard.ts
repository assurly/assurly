import type Stripe from 'stripe';
import { ApiError } from './apiSecurity';
import { PRO_TRIAL_PERIOD_DAYS } from './pricing';
import {
  collectOrganizationSubscriptions,
  isBlockingSubscriptionStatus,
  listCustomerSubscriptions,
  subscriptionUsedTrial,
} from './stripeSubscriptions';

export { PRO_TRIAL_PERIOD_DAYS };

export interface CheckoutEligibility {
  trialPeriodDays: typeof PRO_TRIAL_PERIOD_DAYS | null;
}

function customerBelongsToForeignOrganization(
  customer: Stripe.Customer,
  organizationId: string,
): boolean {
  const metadataOrganizationId = customer.metadata.organizationId;
  return Boolean(metadataOrganizationId && metadataOrganizationId !== organizationId);
}

async function emailHasUsedTrial(
  stripe: Stripe,
  userEmail: string,
  organizationId: string,
): Promise<boolean> {
  const listed = await stripe.customers.list({ email: userEmail, limit: 10 });
  for (const customer of listed.data) {
    if (customerBelongsToForeignOrganization(customer, organizationId)) continue;
    const subscriptions = await listCustomerSubscriptions(stripe, customer.id);
    if (subscriptions.some(subscriptionUsedTrial)) return true;
  }
  return false;
}

export async function expireOpenCheckoutSessions(
  stripe: Stripe,
  customerId: string,
): Promise<void> {
  const openSessions = await stripe.checkout.sessions.list({
    customer: customerId,
    status: 'open',
    limit: 100,
  });
  await Promise.all(
    openSessions.data.map((session) => stripe.checkout.sessions.expire(session.id)),
  );
}

/**
 * Stripe is the source of truth: refuse a second live subscription, and grant the
 * 3-day trial only when this customer (or the same email) has never trialed.
 */
export async function evaluateCheckoutEligibility(
  stripe: Stripe,
  organizationId: string,
  customerId: string,
  userEmail: string,
): Promise<CheckoutEligibility> {
  await expireOpenCheckoutSessions(stripe, customerId);

  const subscriptions = await collectOrganizationSubscriptions(stripe, organizationId, customerId);
  if (subscriptions.some((subscription) => isBlockingSubscriptionStatus(subscription.status))) {
    throw new ApiError(
      409,
      'already_subscribed',
      'This workspace already has a Pro subscription. Manage it from billing.',
    );
  }

  const trialUsedOnCustomer = subscriptions.some(subscriptionUsedTrial);
  const trialUsedOnEmail = trialUsedOnCustomer
    ? true
    : await emailHasUsedTrial(stripe, userEmail, organizationId);

  return { trialPeriodDays: trialUsedOnEmail ? null : PRO_TRIAL_PERIOD_DAYS };
}
