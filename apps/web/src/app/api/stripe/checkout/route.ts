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
import { getAdminDbAdapter } from '../../../../utils/dbAdapter';
import { getAppUrl, getStripeClient, getStripePriceId } from '../../../../utils/stripe';
import { evaluateCheckoutEligibility } from '../../../../utils/stripeCheckoutGuard';
import { ensureStripeCustomer } from '../../../../utils/stripeCustomer';
import { reconcileOrganizationBilling } from '../../../../utils/stripeReconcile';

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
    if (organization.billing_plan === 'oem') {
      throw new ApiError(403, 'plan_required', 'OEM workspaces are billed out of band.');
    }

    const stripe = getStripeClient();
    const adminDb = getAdminDbAdapter();
    const customer = await ensureStripeCustomer(
      stripe,
      organization,
      context.user.email,
      (organizationId, stripeCustomerId) =>
        adminDb.setOrganizationStripeCustomerId(organizationId, stripeCustomerId),
      (organizationId) => adminDb.getOrganization(organizationId),
    );

    try {
      await reconcileOrganizationBilling(stripe, adminDb, {
        ...organization,
        stripe_customer_id: customer.id,
      });
    } catch (error) {
      console.warn('[Assurly] checkout billing reconcile failed:', (error as Error).message);
    }

    const eligibility = await evaluateCheckoutEligibility(
      stripe,
      organization.id,
      customer.id,
      context.user.email,
    );

    const appUrl = getAppUrl();
    const priceId = getStripePriceId(body.plan);
    const subscriptionData: Stripe.Checkout.SessionCreateParams.SubscriptionData = {
      metadata: { organizationId: organization.id, priceId },
      ...(eligibility.trialPeriodDays ? { trial_period_days: eligibility.trialPeriodDays } : {}),
    };
    const session = await stripe.checkout.sessions.create({
      customer: customer.id,
      mode: 'subscription',
      payment_method_collection: 'always',
      success_url: `${appUrl}/dashboard?success=stripe_upgrade`,
      cancel_url: `${appUrl}/dashboard?cancel=stripe_cancelled`,
      client_reference_id: organization.id,
      line_items: [{ price: priceId, quantity: 1 }],
      metadata: { organizationId: organization.id, priceId },
      subscription_data: subscriptionData,
    });
    if (!session.url)
      throw new ApiError(502, 'invalid_upstream_response', 'Checkout is unavailable.');
    return NextResponse.json({
      url: assertTrustedRedirect(session.url, ['https://checkout.stripe.com']),
    });
  },
);
