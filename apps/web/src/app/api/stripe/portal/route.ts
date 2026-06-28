import { NextResponse } from 'next/server';
import {
  ApiError,
  assertTrustedRedirect,
  emptyBodySchema,
  emptyObjectSchema,
  RATE_LIMITS,
  requireRouteUser,
  secureRoute,
} from '../../../../utils/apiSecurity';
import { requireOrganizationMember } from '../../../../utils/authorization';
import { getAdminDbAdapter } from '../../../../utils/dbAdapter';
import { getAppUrl, getStripeClient } from '../../../../utils/stripe';
import { ensureStripeCustomerForPortal } from '../../../../utils/stripeCustomer';

export const POST = secureRoute(
  {
    routeId: 'stripe:portal',
    auth: 'required',
    query: emptyObjectSchema,
    params: emptyObjectSchema,
    body: emptyBodySchema,
    bodyMode: 'none',
    maxBodyBytes: 0,
    rateLimit: RATE_LIMITS.sensitive,
    csrf: true,
  },
  async ({ auth }) => {
    const context = requireRouteUser(auth);
    const organization = await context.db.getOrganizationByUserId(context.user.id);
    if (!organization) {
      throw new ApiError(404, 'not_found', 'Workspace not found.');
    }
    await requireOrganizationMember(context, organization.id);

    const stripe = getStripeClient();
    const customer = await ensureStripeCustomerForPortal(
      stripe,
      organization,
      context.user.email,
      (organizationId, stripeCustomerId) =>
        getAdminDbAdapter().setOrganizationStripeCustomerId(organizationId, stripeCustomerId),
    );

    const session = await stripe.billingPortal.sessions.create({
      customer: customer.id,
      return_url: `${getAppUrl()}/dashboard`,
    });
    return NextResponse.json({
      url: assertTrustedRedirect(session.url, ['https://billing.stripe.com']),
    });
  },
);
