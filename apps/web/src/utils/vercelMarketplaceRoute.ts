import { NextResponse } from 'next/server';
import { z } from 'zod';
import {
  ApiError,
  emptyObjectSchema,
  RATE_LIMITS,
  secureRoute,
  type SecuredRouteHandler,
} from './apiSecurity';
import { getAdminDbAdapter } from './dbAdapter';
import { getVercelIntegrationConfig } from './vercelIntegration';
import { MarketplaceError, type MarketplaceDeps } from './vercelMarketplace';
import { createVercelMarketplaceApi } from './vercelMarketplaceApi';
import {
  bearerToken,
  MarketplaceAuthError,
  verifyMarketplaceToken,
  type MarketplaceCaller,
} from './vercelMarketplaceToken';
import { decryptVercelToken, encryptVercelToken } from './vercelToken';

const MAX_BODY_BYTES = 64 * 1024;

export const installationParamsSchema = z.object({
  installationId: z.string().regex(/^icfg_[A-Za-z0-9]{1,64}$/),
});

export const resourceParamsSchema = installationParamsSchema.extend({
  resourceId: z.uuid(),
});

export interface MarketplaceRouteContext<Params> {
  caller: MarketplaceCaller;
  params: Params;
  /** Parsed JSON, or undefined when the request had no body. */
  body: unknown;
  deps: MarketplaceDeps;
}

interface MarketplaceRouteConfig<Params> {
  routeId: string;
  params: z.ZodType<Params>;
  /** User-auth calls that change something need a team ADMIN. */
  requireAdmin: boolean;
}

export function marketplaceDeps(): MarketplaceDeps {
  return {
    db: getAdminDbAdapter(),
    encryptToken: encryptVercelToken,
    decryptToken: decryptVercelToken,
    apiFor: (token) => createVercelMarketplaceApi(token),
  };
}

/** Parses `body` with `schema`, answering Vercel with a 400 it can show. */
export function parseMarketplaceBody<T>(schema: z.ZodType<T>, body: unknown): T {
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new MarketplaceError(
      400,
      'validation_error',
      'Request body failed validation.',
      null,
      parsed.error.issues.slice(0, 10).map((issue) => ({
        key: issue.path.join('.') || 'body',
        message: issue.message,
      })),
    );
  }
  return parsed.data;
}

/**
 * A Partner API endpoint. Before the handler runs:
 * - the bearer token is a Vercel Marketplace OIDC token for our integration,
 * - the token's `installation_id` is the one in the path, so one team can
 *   never act on another team's installation,
 * - a user token changing state belongs to a team ADMIN.
 */
export function marketplaceRoute<Params extends { installationId: string }>(
  config: MarketplaceRouteConfig<Params>,
  handler: (context: MarketplaceRouteContext<Params>) => Promise<Response>,
): SecuredRouteHandler<Record<string, never>, string, Params> {
  return secureRoute(
    {
      routeId: config.routeId,
      auth: 'none',
      query: emptyObjectSchema as unknown as z.ZodType<Record<string, never>>,
      params: config.params,
      body: z.string().max(MAX_BODY_BYTES),
      bodyMode: 'raw',
      maxBodyBytes: MAX_BODY_BYTES,
      rateLimit: RATE_LIMITS.webhook,
    },
    async ({ request, params, body }) => {
      const integration = getVercelIntegrationConfig();
      if (!integration) {
        throw new ApiError(503, 'not_configured', 'The Vercel integration is not configured.');
      }
      const token = bearerToken(request);
      if (!token)
        throw new ApiError(401, 'unauthorized', 'A Vercel Marketplace token is required.');

      let caller: MarketplaceCaller;
      try {
        caller = await verifyMarketplaceToken(token, { clientId: integration.clientId });
      } catch (error) {
        if (error instanceof MarketplaceAuthError && error.reason.startsWith('jwks')) {
          // Our side could not fetch Vercel's keys: a retry will succeed, a 401 would not.
          throw new ApiError(503, 'unavailable', 'Could not verify the token right now.');
        }
        if (error instanceof MarketplaceAuthError) {
          throw new ApiError(401, 'unauthorized', 'The Vercel Marketplace token is not valid.');
        }
        throw error;
      }
      if (caller.installationId !== params.installationId) {
        throw new ApiError(403, 'forbidden', 'The token does not belong to this installation.');
      }
      if (config.requireAdmin && caller.kind === 'user' && caller.userRole !== 'ADMIN') {
        throw new ApiError(403, 'forbidden', 'Only a team admin can change this installation.');
      }

      let parsedBody: unknown;
      if (body.trim()) {
        try {
          parsedBody = JSON.parse(body);
        } catch {
          throw new ApiError(400, 'invalid_json', 'Request body must be valid JSON.');
        }
      }

      try {
        return await handler({ caller, params, body: parsedBody, deps: marketplaceDeps() });
      } catch (error) {
        if (error instanceof MarketplaceError) {
          return NextResponse.json(error.toBody(), { status: error.status });
        }
        throw error;
      }
    },
  );
}
