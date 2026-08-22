import type Stripe from 'stripe';
import type { Organization } from './dbAdapter';
import { ApiError } from './apiSecurity';
import { isMissingStripeResource } from './stripe';

/**
 * Loads a Stripe customer by id. Returns null when the id is stale or was never
 * valid in the current Stripe account (e.g. mock seed data or test/live mismatch).
 */
export async function retrieveStripeCustomer(
  stripe: Stripe,
  customerId: string,
): Promise<Stripe.Customer | null> {
  try {
    const customer = await stripe.customers.retrieve(customerId);
    return customer.deleted ? null : customer;
  } catch (error) {
    if (isMissingStripeResource(error)) return null;
    throw error;
  }
}

/** Ensures the customer belongs to the workspace when metadata is present. */
export function assertOrganizationOwnsCustomer(
  customer: Stripe.Customer,
  organizationId: string,
): void {
  const metadataOrganizationId = customer.metadata.organizationId;
  if (metadataOrganizationId && metadataOrganizationId !== organizationId) {
    throw new ApiError(404, 'not_found', 'Billing account not found.');
  }
}

/**
 * Attempts to locate the live Stripe customer for a workspace when the stored
 * database id is missing or invalid. Uses subscription metadata first, then
 * customer metadata, then a conservative email match.
 */
export async function discoverStripeCustomerForOrganization(
  stripe: Stripe,
  organizationId: string,
  userEmail: string,
): Promise<Stripe.Customer | null> {
  for (const status of ['active', 'trialing'] as const) {
    const subscriptions = await stripe.subscriptions.search({
      query: `metadata['organizationId']:'${organizationId}' status:'${status}'`,
      limit: 1,
    });
    if (subscriptions.data.length === 0) continue;

    const subscription = subscriptions.data[0];
    const customerId =
      typeof subscription.customer === 'string' ? subscription.customer : subscription.customer.id;
    const customer = await retrieveStripeCustomer(stripe, customerId);
    if (!customer) continue;

    assertOrganizationOwnsCustomer(customer, organizationId);
    return customer;
  }

  const byMetadata = await stripe.customers.search({
    query: `metadata['organizationId']:'${organizationId}'`,
    limit: 1,
  });
  if (byMetadata.data.length > 0) {
    const customer = byMetadata.data[0];
    assertOrganizationOwnsCustomer(customer, organizationId);
    return customer;
  }

  const listed = await stripe.customers.list({ email: userEmail, limit: 10 });
  for (const customer of listed.data) {
    const metadataOrganizationId = customer.metadata.organizationId;
    if (!metadataOrganizationId || metadataOrganizationId === organizationId) {
      assertOrganizationOwnsCustomer(customer, organizationId);
      return customer;
    }
  }

  return null;
}

export async function resolveStripeCustomerForOrganization(
  stripe: Stripe,
  organizationId: string,
  storedCustomerId: string | undefined,
  userEmail: string,
): Promise<Stripe.Customer | null> {
  if (storedCustomerId) {
    const stored = await retrieveStripeCustomer(stripe, storedCustomerId);
    if (stored) {
      assertOrganizationOwnsCustomer(stored, organizationId);
      return stored;
    }
  }

  return discoverStripeCustomerForOrganization(stripe, organizationId, userEmail);
}

function isUniqueCustomerConflict(error: unknown): boolean {
  return error instanceof Error && /Supabase request failed \(409\)/.test(error.message);
}

/**
 * Guarantees a usable Stripe customer for Checkout and the billing portal:
 * reuse a valid stored id, rediscover a live customer, or create a fresh one.
 * Never fall back to `customer_email` — a new Stripe customer would mint a new trial.
 */
export async function ensureStripeCustomer(
  stripe: Stripe,
  organization: Organization,
  userEmail: string,
  syncCustomerId: (organizationId: string, customerId: string) => Promise<void>,
  reloadOrganization?: (organizationId: string) => Promise<Organization | null>,
): Promise<Stripe.Customer> {
  let customer = await resolveStripeCustomerForOrganization(
    stripe,
    organization.id,
    organization.stripe_customer_id,
    userEmail,
  );

  if (!customer) {
    customer = await stripe.customers.create({
      email: userEmail,
      name: organization.name,
      metadata: { organizationId: organization.id },
    });
  }

  if (organization.stripe_customer_id === customer.id) return customer;

  try {
    await syncCustomerId(organization.id, customer.id);
    return customer;
  } catch (error) {
    if (!isUniqueCustomerConflict(error) || !reloadOrganization) throw error;
    const latest = await reloadOrganization(organization.id);
    const storedId = latest?.stripe_customer_id;
    if (!storedId || storedId === customer.id) throw error;
    const winner = await retrieveStripeCustomer(stripe, storedId);
    if (!winner) throw error;
    assertOrganizationOwnsCustomer(winner, organization.id);
    return winner;
  }
}
