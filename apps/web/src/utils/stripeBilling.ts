import type Stripe from 'stripe';
import type { DbAdapter, StripeBillingEvent } from './dbAdapter';
import { getAllowedStripePriceIds } from './stripe';
import { applyTrialCardReuse } from './stripeTrialFingerprint';
import {
  isLiveSubscriptionStatus,
  listLiveOrganizationSubscriptions,
  oldestSubscription,
  planForSubscriptionStatus,
} from './stripeSubscriptions';

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

function invoiceSubscriptionId(invoice: Stripe.Invoice): string | null {
  const raw = invoice.parent?.subscription_details?.subscription;
  if (!raw) return null;
  return typeof raw === 'string' ? raw : raw.id;
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

async function loadOrganization(
  db: DbAdapter,
  organizationId: string,
  customerId: string,
): Promise<NonNullable<Awaited<ReturnType<DbAdapter['getOrganization']>>>> {
  const organization = await db.getOrganization(organizationId);
  if (!organization) throw new StripeBillingValidationError('Unknown organization.');
  if (organization.stripe_customer_id && organization.stripe_customer_id !== customerId) {
    throw new StripeBillingValidationError('Stripe customer belongs to another organization.');
  }
  return organization;
}

function billingEventFromSubscription(
  event: Stripe.Event,
  subscription: Stripe.Subscription,
  organizationId: string,
  customerId: string,
  priceId: string,
): StripeBillingEvent {
  return {
    eventId: event.id,
    eventType: event.type,
    organizationId,
    plan: planForSubscriptionStatus(subscription.status),
    stripeCustomerId: customerId,
    stripeSubscriptionId: subscription.id,
    stripePriceId: priceId,
  };
}

async function checkoutBillingEvent(
  stripe: Stripe,
  event: Stripe.Event,
): Promise<{ billingEvent: StripeBillingEvent; subscription: Stripe.Subscription }> {
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

  if (!subscription || !isLiveSubscriptionStatus(subscription.status)) {
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
    subscription,
    billingEvent: {
      eventId: event.id,
      eventType: event.type,
      organizationId,
      plan: 'pro',
      stripeCustomerId: customerId,
      stripeSubscriptionId: subscription.id,
      stripePriceId: priceId,
    },
  };
}

async function subscriptionBillingEvent(
  stripe: Stripe,
  event: Stripe.Event,
  retrieved?: Stripe.Subscription,
): Promise<{ billingEvent: StripeBillingEvent; subscription: Stripe.Subscription }> {
  const eventSubscription = retrieved ?? (event.data.object as Stripe.Subscription);
  const subscription = retrieved ?? (await stripe.subscriptions.retrieve(eventSubscription.id));
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
    subscription,
    billingEvent: billingEventFromSubscription(
      event,
      subscription,
      organizationId,
      customerId,
      priceId,
    ),
  };
}

async function invoiceBillingEvent(
  stripe: Stripe,
  event: Stripe.Event,
): Promise<{ billingEvent: StripeBillingEvent; subscription: Stripe.Subscription } | null> {
  const invoice = event.data.object as Stripe.Invoice;
  const subscriptionId = invoiceSubscriptionId(invoice);
  if (!subscriptionId) return null;
  const subscription = await stripe.subscriptions.retrieve(subscriptionId);
  return subscriptionBillingEvent(stripe, event, subscription);
}

/**
 * When a race creates two live subscriptions, keep the oldest and cancel the rest.
 * Returns whether `incoming` is the one that should drive billing_plan.
 */
export async function cancelDuplicateLiveSubscriptions(
  stripe: Stripe,
  organizationId: string,
  incoming: Stripe.Subscription,
): Promise<'keep' | 'duplicate'> {
  if (!isLiveSubscriptionStatus(incoming.status)) return 'keep';

  const live = await listLiveOrganizationSubscriptions(stripe, organizationId);
  const unique = new Map<string, Stripe.Subscription>();
  unique.set(incoming.id, incoming);
  for (const subscription of live) unique.set(subscription.id, subscription);
  const all = [...unique.values()];
  if (all.length <= 1) return 'keep';

  const kept = oldestSubscription(all);
  await Promise.all(
    all
      .filter((subscription) => subscription.id !== kept.id)
      .map((subscription) => stripe.subscriptions.cancel(subscription.id)),
  );
  return incoming.id === kept.id ? 'keep' : 'duplicate';
}

export async function processStripeEvent(
  stripe: Stripe,
  db: DbAdapter,
  event: Stripe.Event,
): Promise<'processed' | 'duplicate' | 'ignored'> {
  let parsed: { billingEvent: StripeBillingEvent; subscription: Stripe.Subscription } | null;

  if (event.type === 'checkout.session.completed') {
    parsed = await checkoutBillingEvent(stripe, event);
  } else if (
    event.type === 'customer.subscription.updated' ||
    event.type === 'customer.subscription.deleted'
  ) {
    parsed = await subscriptionBillingEvent(stripe, event);
  } else if (event.type === 'invoice.payment_failed') {
    parsed = await invoiceBillingEvent(stripe, event);
    if (!parsed) return 'ignored';
  } else {
    return 'ignored';
  }

  const organization = await loadOrganization(
    db,
    parsed.billingEvent.organizationId,
    parsed.billingEvent.stripeCustomerId,
  );
  if (organization.billing_plan === 'oem') return 'ignored';

  parsed = await applyTrialCardReuse(stripe, db, parsed);

  if (
    event.type === 'checkout.session.completed' ||
    event.type === 'customer.subscription.updated'
  ) {
    const uniqueness = await cancelDuplicateLiveSubscriptions(
      stripe,
      parsed.billingEvent.organizationId,
      parsed.subscription,
    );
    if (uniqueness === 'duplicate') return 'ignored';
  }

  return (await db.processStripeBillingEvent(parsed.billingEvent)) ? 'processed' : 'duplicate';
}
