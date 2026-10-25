import { NextResponse } from 'next/server';
import {
  provisionResource,
  provisionResourceBodySchema,
} from '../../../../../../../../utils/vercelMarketplace';
import {
  installationParamsSchema,
  marketplaceRoute,
  parseMarketplaceBody,
} from '../../../../../../../../utils/vercelMarketplaceRoute';

/** Partner API: a team creates a Live Lock from the Vercel dashboard. */
export const POST = marketplaceRoute(
  {
    routeId: 'vercel:marketplace:resource:provision',
    params: installationParamsSchema,
    requireAdmin: true,
  },
  async ({ params, body, deps }) => {
    const input = parseMarketplaceBody(provisionResourceBodySchema, body);
    return NextResponse.json(await provisionResource(params.installationId, input, deps), {
      status: 201,
    });
  },
);
