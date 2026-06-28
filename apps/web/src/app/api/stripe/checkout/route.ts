import { NextResponse } from 'next/server';
import type Stripe from 'stripe';
import { z } from 'zod';
import {
  ApiError,
  assertTrustedRedirect,
  emptyObjectSchema,
  RATE_LIMITS,
  requireRouteUser,
  secureRoute,
} from '../../../../utils/apiSecurity';
import { requireOrganizationMember } from '../../../../utils/authorization';
import { getAppUrl, getStripeClient, getStripePriceId } from '../../../../utils/stripe';
import { verifiedCheckoutCustomerId } from '../../../../utils/stripeCustomer';

const checkoutBody = z.object({ plan: z.enum(['monthly', 'yearly']) }).strict();

export const POST = secureRoute(
  {
    routeId: 'stripe:checkout',
    auth: 'required',
    query: emptyObjectSchema,
    params: emptyObjectSchema,
    body: checkoutBody,
    bodyMode: 'json',
    maxBodyBytes: 1024,
    rateLimit: RATE_LIMITS.sensitive,
    csrf: true,
  },
  async ({ auth, body }) => {
    const context = requireRouteUser(auth);
    const organization = await context.db.getOrganizationByUserId(context.user.id);
    if (!organization) throw new ApiError(404, 'not_found', 'Workspace not found.');
    await requireOrganizationMember(context, organization.id);

    const stripe = getStripeClient();
    const appUrl = getAppUrl();
    const priceId = getStripePriceId(body.plan);
    const customerId = await verifiedCheckoutCustomerId(
      stripe,
      organization.stripe_customer_id,
      organization.id,
    );
    const customer: Pick<Stripe.Checkout.SessionCreateParams, 'customer' | 'customer_email'> =
      customerId ? { customer: customerId } : { customer_email: context.user.email };
    const session = await stripe.checkout.sessions.create({
      ...customer,
      mode: 'subscription',
      success_url: `${appUrl}/dashboard?success=stripe_upgrade`,
      cancel_url: `${appUrl}/dashboard?cancel=stripe_cancelled`,
      client_reference_id: organization.id,
      line_items: [{ price: priceId, quantity: 1 }],
      metadata: { organizationId: organization.id, priceId },
      subscription_data: {
        metadata: { organizationId: organization.id, priceId },
        trial_period_days: 7,
      },
    });
    if (!session.url)
      throw new ApiError(502, 'invalid_upstream_response', 'Checkout is unavailable.');
    return NextResponse.json({
      url: assertTrustedRedirect(session.url, ['https://checkout.stripe.com']),
    });
  },
);
