import type Stripe from 'stripe';
import type { DbAdapter, StripeBillingEvent } from './dbAdapter';
import { getAllowedStripePriceIds } from './stripe';

export class StripeBillingValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StripeBillingValidationError';
  }
}

function requireId(value: string | { id: string } | null, label: string): string {
  if (typeof value === 'string' && value) return value;
  if (value && typeof value === 'object' && typeof value.id === 'string') return value.id;
  throw new StripeBillingValidationError(`Missing ${label}.`);
}

function requireOrganizationId(metadata: Stripe.Metadata | null | undefined): string {
  const organizationId = metadata?.organizationId;
  if (!organizationId) {
    throw new StripeBillingValidationError('Missing Stripe organization metadata.');
  }
  return organizationId;
}

function verifiedPriceId(subscription: Stripe.Subscription): string {
  const priceIds = subscription.items.data.map((item) => item.price.id);
  if (priceIds.length !== 1 || !getAllowedStripePriceIds().has(priceIds[0])) {
    throw new StripeBillingValidationError('Subscription uses an unrecognized Stripe price.');
  }
  return priceIds[0];
}

function planForStatus(status: Stripe.Subscription.Status): 'free' | 'pro' {
  return status === 'active' || status === 'trialing' ? 'pro' : 'free';
}

async function verifyCustomer(
  stripe: Stripe,
  customerId: string,
  organizationId: string,
): Promise<void> {
  const customer = await stripe.customers.retrieve(customerId);
  if (customer.deleted) {
    throw new StripeBillingValidationError('Stripe customer has been deleted.');
  }
  const metadataOrganizationId = customer.metadata.organizationId;
  if (metadataOrganizationId && metadataOrganizationId !== organizationId) {
    throw new StripeBillingValidationError('Stripe customer belongs to another organization.');
  }
}

async function verifyOrganization(
  db: DbAdapter,
  organizationId: string,
  customerId: string,
): Promise<void> {
  const organization = await db.getOrganization(organizationId);
  if (!organization) throw new StripeBillingValidationError('Unknown organization.');
  if (organization.stripe_customer_id && organization.stripe_customer_id !== customerId) {
    throw new StripeBillingValidationError('Stripe customer belongs to another organization.');
  }
}

async function checkoutBillingEvent(
  stripe: Stripe,
  event: Stripe.Event,
): Promise<StripeBillingEvent> {
  const eventSession = event.data.object as Stripe.Checkout.Session;
  const session = await stripe.checkout.sessions.retrieve(eventSession.id, {
    expand: ['subscription'],
  });

  if (session.mode !== 'subscription' || session.status !== 'complete') {
    throw new StripeBillingValidationError('Checkout Session is not a completed subscription.');
  }
  if (!['paid', 'no_payment_required'].includes(session.payment_status)) {
    throw new StripeBillingValidationError('Checkout payment is not eligible for activation.');
  }

  const organizationId = requireOrganizationId(session.metadata);
  if (session.client_reference_id !== organizationId) {
    throw new StripeBillingValidationError('Checkout organization identifiers do not match.');
  }

  const customerId = requireId(session.customer, 'Stripe customer');
  const subscriptionId = requireId(session.subscription, 'Stripe subscription');
  const subscription =
    typeof session.subscription === 'string'
      ? await stripe.subscriptions.retrieve(subscriptionId)
      : session.subscription;

  if (!subscription || !['active', 'trialing'].includes(subscription.status)) {
    throw new StripeBillingValidationError('Subscription is not active or trialing.');
  }
  if (requireId(subscription.customer, 'subscription customer') !== customerId) {
    throw new StripeBillingValidationError('Checkout and subscription customers do not match.');
  }
  if (requireOrganizationId(subscription.metadata) !== organizationId) {
    throw new StripeBillingValidationError('Subscription organization does not match Checkout.');
  }

  const priceId = verifiedPriceId(subscription);
  if (session.metadata?.priceId !== priceId || subscription.metadata.priceId !== priceId) {
    throw new StripeBillingValidationError(
      'Stripe price metadata does not match the subscription.',
    );
  }
  await verifyCustomer(stripe, customerId, organizationId);

  return {
    eventId: event.id,
    eventType: event.type,
    organizationId,
    plan: 'pro',
    stripeCustomerId: customerId,
    stripeSubscriptionId: subscription.id,
    stripePriceId: priceId,
  };
}

async function subscriptionBillingEvent(
  stripe: Stripe,
  event: Stripe.Event,
): Promise<StripeBillingEvent> {
  const eventSubscription = event.data.object as Stripe.Subscription;
  const subscription = await stripe.subscriptions.retrieve(eventSubscription.id);
  const organizationId = requireOrganizationId(subscription.metadata);
  const customerId = requireId(subscription.customer, 'Stripe customer');
  const priceId = verifiedPriceId(subscription);

  if (subscription.metadata.priceId !== priceId) {
    throw new StripeBillingValidationError(
      'Stripe price metadata does not match the subscription.',
    );
  }
  if (event.type === 'customer.subscription.deleted' && subscription.status !== 'canceled') {
    throw new StripeBillingValidationError('Deleted subscription event is not canceled.');
  }

  await verifyCustomer(stripe, customerId, organizationId);
  return {
    eventId: event.id,
    eventType: event.type,
    organizationId,
    plan: planForStatus(subscription.status),
    stripeCustomerId: customerId,
    stripeSubscriptionId: subscription.id,
    stripePriceId: priceId,
  };
}

export async function processStripeEvent(
  stripe: Stripe,
  db: DbAdapter,
  event: Stripe.Event,
): Promise<'processed' | 'duplicate' | 'ignored'> {
  let billingEvent: StripeBillingEvent;

  if (event.type === 'checkout.session.completed') {
    billingEvent = await checkoutBillingEvent(stripe, event);
  } else if (
    event.type === 'customer.subscription.updated' ||
    event.type === 'customer.subscription.deleted'
  ) {
    billingEvent = await subscriptionBillingEvent(stripe, event);
  } else {
    return 'ignored';
  }

  await verifyOrganization(db, billingEvent.organizationId, billingEvent.stripeCustomerId);
  return (await db.processStripeBillingEvent(billingEvent)) ? 'processed' : 'duplicate';
}
