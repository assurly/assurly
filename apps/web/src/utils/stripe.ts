import Stripe from 'stripe';
import { ConfigurationError } from './env';

export type BillingInterval = 'monthly' | 'yearly';

let stripeClient: Stripe | undefined;
let stripeClientKey: string | undefined;

function requiredEnvironmentVariable(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new ConfigurationError(`${name} is required for Stripe billing.`);
  return value;
}

export function getStripeClient(): Stripe {
  const secretKey = requiredEnvironmentVariable('STRIPE_SECRET_KEY');
  if (!stripeClient || stripeClientKey !== secretKey) {
    stripeClient = new Stripe(secretKey, {
      maxNetworkRetries: 2,
      typescript: true,
    });
    stripeClientKey = secretKey;
  }
  return stripeClient;
}

export function isMissingStripeResource(error: unknown): boolean {
  return (
    error instanceof Stripe.errors.StripeInvalidRequestError && error.code === 'resource_missing'
  );
}

export function getStripeWebhookSecret(): string {
  return requiredEnvironmentVariable('STRIPE_WEBHOOK_SECRET');
}

export function getStripePriceId(interval: BillingInterval): string {
  return requiredEnvironmentVariable(
    interval === 'yearly' ? 'STRIPE_PRICE_YEARLY' : 'STRIPE_PRICE_MONTHLY',
  );
}

export function getAllowedStripePriceIds(): ReadonlySet<string> {
  return new Set([getStripePriceId('monthly'), getStripePriceId('yearly')]);
}

export function getAppUrl(): string {
  const configuredUrl = requiredEnvironmentVariable('APP_URL');

  let appUrl: URL;
  try {
    appUrl = new URL(configuredUrl);
  } catch {
    throw new ConfigurationError('APP_URL must be an absolute URL.');
  }

  if (!['http:', 'https:'].includes(appUrl.protocol)) {
    throw new ConfigurationError('APP_URL must use HTTP or HTTPS.');
  }
  if (process.env.NODE_ENV === 'production' && appUrl.protocol !== 'https:') {
    throw new ConfigurationError('APP_URL must use HTTPS in production.');
  }

  return appUrl.toString().replace(/\/$/, '');
}
