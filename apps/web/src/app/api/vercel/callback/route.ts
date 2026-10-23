import { NextResponse } from 'next/server';
import { z } from 'zod';
import {
  ApiError,
  emptyBodySchema,
  RATE_LIMITS,
  requireRouteUser,
  secureRoute,
} from '../../../../utils/apiSecurity';
import { getAdminDbAdapter } from '../../../../utils/dbAdapter';
import { getApplicationUrl } from '../../../../utils/env';
import { readVercelState, vercelRedirectUri } from '../../../../utils/vercelOauth';
import { encryptVercelToken } from '../../../../utils/vercelToken';

const callbackQuery = z
  .object({
    code: z.string().min(1).max(500).optional(),
    state: z.string().min(1).max(500).optional(),
  })
  .strict();

/**
 * Stores the Vercel token for the workspace named in the signed state.
 * The plaintext token is encrypted before it is written and is not redirected.
 */
export const GET = secureRoute(
  {
    routeId: 'vercel:callback',
    auth: 'required',
    query: callbackQuery,
    params: z.object({}).strict(),
    body: emptyBodySchema,
    bodyMode: 'none',
    maxBodyBytes: 0,
    rateLimit: RATE_LIMITS.sensitive,
  },
  async ({ auth, query }) => {
    const context = requireRouteUser(auth);
    const organization = await context.db.getOrganizationByUserId(context.user.id);
    if (!organization || !query.code || !query.state) {
      throw new ApiError(400, 'invalid_request', 'Vercel did not return a connection code.');
    }
    const organizationId = readVercelState(query.state);
    if (!organizationId || organizationId !== organization.id) {
      throw new ApiError(400, 'invalid_request', 'Vercel connection state is not valid.');
    }

    const clientId = process.env.VERCEL_CLIENT_ID?.trim();
    const clientSecret = process.env.VERCEL_CLIENT_SECRET?.trim();
    if (!clientId || !clientSecret) {
      throw new ApiError(
        503,
        'vercel_not_configured',
        'Vercel is not connected on this workspace yet.',
      );
    }

    const body = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code: query.code,
      redirect_uri: vercelRedirectUri(),
    });
    const response = await fetch('https://api.vercel.com/v2/oauth/access_token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    if (!response.ok) {
      throw new ApiError(502, 'vercel_token_failed', 'Vercel did not accept the connection.');
    }
    const tokenBody = (await response.json()) as { access_token?: unknown; team_id?: unknown };
    if (typeof tokenBody.access_token !== 'string' || !tokenBody.access_token) {
      throw new ApiError(502, 'vercel_token_failed', 'Vercel did not accept the connection.');
    }
    const teamId = typeof tokenBody.team_id === 'string' ? tokenBody.team_id : null;
    await getAdminDbAdapter().upsertVercelConnection(
      organization.id,
      teamId,
      encryptVercelToken(tokenBody.access_token),
    );
    return NextResponse.redirect(`${getApplicationUrl()}/dashboard`);
  },
);
