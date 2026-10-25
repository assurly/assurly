import { NextResponse } from 'next/server';
import { MARKETPLACE_PLANS } from '../../../../../../../../utils/vercelMarketplace';
import {
  installationParamsSchema,
  marketplaceRoute,
} from '../../../../../../../../utils/vercelMarketplaceRoute';

/** Partner API: the plans an installation may switch between. */
export const GET = marketplaceRoute(
  {
    routeId: 'vercel:marketplace:installation:plans',
    params: installationParamsSchema,
    requireAdmin: false,
  },
  async () => NextResponse.json({ plans: Object.values(MARKETPLACE_PLANS) }),
);
