import crypto from 'node:crypto';
import type Stripe from 'stripe';
import type { DbAdapter, StripeBillingEvent } from './dbAdapter';
import { planForSubscriptionStatus, subscriptionUsedTrial } from './stripeSubscriptions';

const FINGERPRINT_NAMESPACE = 'assurly:trial-card:';

export function hashTrialCardFingerprint(fingerprint: string): string {
  return crypto
    .createHash('sha256')
    .update(`${FINGERPRINT_NAMESPACE}${fingerprint}`, 'utf8')
    .digest('hex');
}

function paymentMethodId(value: string | Stripe.PaymentMethod | null | undefined): string | null {
  if (typeof value === 'string' && value) return value;
  if (value && typeof value === 'object' && typeof value.id === 'string') return value.id;
  return null;
}

function fingerprintFromExpandedPaymentMethod(
  value: string | Stripe.PaymentMethod | null | undefined,
): string | null {
  if (value && typeof value === 'object' && value.card?.fingerprint) {
    return value.card.fingerprint;
  }
  return null;
}

export async function readSubscriptionCardFingerprint(
  stripe: Stripe,
  subscription: Stripe.Subscription,
): Promise<string | null> {
  const expanded = fingerprintFromExpandedPaymentMethod(subscription.default_payment_method);
  if (expanded) return expanded;
  const id = paymentMethodId(subscription.default_payment_method);
  if (!id) return null;
  const paymentMethod = await stripe.paymentMethods.retrieve(id);
  return paymentMethod.card?.fingerprint ?? null;
}

/**
 * One trial per card fingerprint. First claim keeps the trial; a later checkout
 * with the same card ends the trial immediately so Stripe charges now.
 */
export async function applyTrialCardReuse(
  stripe: Stripe,
  db: Pick<DbAdapter, 'claimTrialCardFingerprint'>,
  parsed: { billingEvent: StripeBillingEvent; subscription: Stripe.Subscription },
): Promise<{ billingEvent: StripeBillingEvent; subscription: Stripe.Subscription }> {
  if (!subscriptionUsedTrial(parsed.subscription)) return parsed;

  const fingerprint = await readSubscriptionCardFingerprint(stripe, parsed.subscription);
  if (!fingerprint) return parsed;

  const claimed = await db.claimTrialCardFingerprint({
    fingerprintHash: hashTrialCardFingerprint(fingerprint),
    stripeCustomerId: parsed.billingEvent.stripeCustomerId,
    organizationId: parsed.billingEvent.organizationId,
    stripeSubscriptionId: parsed.subscription.id,
  });
  if (claimed) return parsed;

  const updated = await stripe.subscriptions.update(parsed.subscription.id, { trial_end: 'now' });
  return {
    subscription: updated,
    billingEvent: {
      ...parsed.billingEvent,
      plan: planForSubscriptionStatus(updated.status),
    },
  };
}
