import { NextResponse } from 'next/server';
import {
  deleteInstallation,
  getInstallation,
  updateInstallationBodySchema,
  updateInstallationPlan,
  upsertInstallationBodySchema,
  upsertInstallation,
} from '../../../../../../../utils/vercelMarketplace';
import {
  installationParamsSchema,
  marketplaceRoute,
  parseMarketplaceBody,
} from '../../../../../../../utils/vercelMarketplaceRoute';

/** Partner API: Vercel calls these when a team installs, changes plan or uninstalls. */

export const PUT = marketplaceRoute(
  {
    routeId: 'vercel:marketplace:installation:upsert',
    params: installationParamsSchema,
    requireAdmin: true,
  },
  async ({ caller, params, body, deps }) => {
    const input = parseMarketplaceBody(upsertInstallationBodySchema, body);
    await upsertInstallation(params.installationId, caller.accountId, input, deps);
    return new NextResponse(null, { status: 204 });
  },
);

export const GET = marketplaceRoute(
  {
    routeId: 'vercel:marketplace:installation:get',
    params: installationParamsSchema,
    requireAdmin: false,
  },
  async ({ params, deps }) => NextResponse.json(await getInstallation(params.installationId, deps)),
);

export const PATCH = marketplaceRoute(
  {
    routeId: 'vercel:marketplace:installation:update',
    params: installationParamsSchema,
    requireAdmin: true,
  },
  async ({ params, body, deps }) => {
    const input = parseMarketplaceBody(updateInstallationBodySchema, body);
    await updateInstallationPlan(params.installationId, input.billingPlanId, deps);
    return new NextResponse(null, { status: 204 });
  },
);

export const DELETE = marketplaceRoute(
  {
    routeId: 'vercel:marketplace:installation:delete',
    params: installationParamsSchema,
    requireAdmin: true,
  },
  async ({ params, deps }) =>
    NextResponse.json(await deleteInstallation(params.installationId, deps)),
);
