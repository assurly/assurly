import { NextResponse } from 'next/server';
import { z } from 'zod';
import { ApiError, RATE_LIMITS, secureRoute } from '../../../../../../../../utils/apiSecurity';
import { getVercelIntegrationConfig } from '../../../../../../../../utils/vercelIntegration';
import {
  LIVE_LOCK_PRODUCT_ID,
  MARKETPLACE_PLANS,
} from '../../../../../../../../utils/vercelMarketplace';
import {
  bearerToken,
  MarketplaceAuthError,
  verifyMarketplaceToken,
} from '../../../../../../../../utils/vercelMarketplaceToken';

/**
 * Partner API: the plans Vercel shows before a resource exists. Vercel sends
 * the form's current metadata as `?metadata=`; the plans do not depend on it.
 */
export const GET = secureRoute(
  {
    routeId: 'vercel:marketplace:product:plans',
    auth: 'none',
    query: z.object({ metadata: z.string().max(4000).optional() }).strict(),
    params: z.object({ productSlug: z.string().regex(/^[a-z0-9-]{1,64}$/) }),
    body: z.undefined(),
    bodyMode: 'none',
    maxBodyBytes: 0,
    rateLimit: RATE_LIMITS.webhook,
  },
  async ({ request, params }) => {
    const integration = getVercelIntegrationConfig();
    if (!integration) {
      throw new ApiError(503, 'not_configured', 'The Vercel integration is not configured.');
    }
    const token = bearerToken(request);
    if (!token) throw new ApiError(401, 'unauthorized', 'A Vercel Marketplace token is required.');
    try {
      await verifyMarketplaceToken(token, { clientId: integration.clientId });
    } catch (error) {
      if (error instanceof MarketplaceAuthError) {
        throw new ApiError(401, 'unauthorized', 'The Vercel Marketplace token is not valid.');
      }
      throw error;
    }
    if (params.productSlug !== LIVE_LOCK_PRODUCT_ID) {
      throw new ApiError(404, 'not_found', 'Unknown product.');
    }
    return NextResponse.json({ plans: Object.values(MARKETPLACE_PLANS) });
  },
);
