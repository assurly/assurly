import { NextResponse } from 'next/server';
import {
  deleteResource,
  getResource,
  updateResource,
  updateResourceBodySchema,
} from '../../../../../../../../../utils/vercelMarketplace';
import {
  marketplaceRoute,
  parseMarketplaceBody,
  resourceParamsSchema,
} from '../../../../../../../../../utils/vercelMarketplaceRoute';

/** Partner API: read, change the mode of, or remove one Live Lock. */

export const GET = marketplaceRoute(
  { routeId: 'vercel:marketplace:resource:get', params: resourceParamsSchema, requireAdmin: false },
  async ({ params, deps }) =>
    NextResponse.json(await getResource(params.installationId, params.resourceId, deps)),
);

export const PATCH = marketplaceRoute(
  {
    routeId: 'vercel:marketplace:resource:update',
    params: resourceParamsSchema,
    requireAdmin: true,
  },
  async ({ params, body, deps }) => {
    const input = parseMarketplaceBody(updateResourceBodySchema, body);
    return NextResponse.json(
      await updateResource(params.installationId, params.resourceId, input, deps),
    );
  },
);

export const DELETE = marketplaceRoute(
  {
    routeId: 'vercel:marketplace:resource:delete',
    params: resourceParamsSchema,
    requireAdmin: true,
  },
  async ({ params, deps }) => {
    await deleteResource(params.installationId, params.resourceId, deps);
    return new NextResponse(null, { status: 204 });
  },
);
