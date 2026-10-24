import { NextResponse } from 'next/server';
import { z } from 'zod';
import {
  ApiError,
  emptyBodySchema,
  RATE_LIMITS,
  requireRouteUser,
  secureRoute,
} from '../../../../../utils/apiSecurity';
import { requireOrganizationMember } from '../../../../../utils/authorization';
import { getAdminDbAdapter } from '../../../../../utils/dbAdapter';
import { linkLiveLockProject } from '../../../../../utils/enableLiveLock';
import { getApplicationUrl } from '../../../../../utils/env';
import {
  createVercelIntegrationApi,
  exchangeIntegrationCode,
  getVercelIntegrationConfig,
  VercelApiError,
} from '../../../../../utils/vercelIntegration';
import { readVercelInstallState } from '../../../../../utils/vercelInstallState';
import { encryptVercelToken } from '../../../../../utils/vercelToken';

// The parameters Vercel documents for the external install flow. `teamId`
// and `source` are accepted but not trusted: the team comes from the code
// exchange, which Vercel answers for this installation only.
const callbackQuery = z
  .object({
    code: z.string().min(1).max(500).optional(),
    state: z.string().min(1).max(500).optional(),
    configurationId: z.string().max(80).optional(),
    teamId: z.string().max(80).optional(),
    next: z.string().max(2048).optional(),
    source: z.string().max(40).optional(),
  })
  .strict();

/** Vercel's `next` closes the install popup. Anything else is not followed. */
function vercelNext(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === 'vercel.com' ? url.toString() : null;
  } catch {
    return null;
  }
}

/**
 * Finishes a Live Lock install. Stores the installation token encrypted, then
 * locks the URL the install started from to the Vercel project that serves it.
 * The token is never returned or redirected.
 */
export const GET = secureRoute(
  {
    routeId: 'vercel:integration:callback',
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
    const state = query.state ? readVercelInstallState(query.state) : null;
    if (!organization || !query.code || !state || state.organizationId !== organization.id) {
      throw new ApiError(400, 'invalid_request', 'Vercel connection state is not valid.');
    }
    await requireOrganizationMember(context, organization.id);

    const config = getVercelIntegrationConfig();
    if (!config) {
      throw new ApiError(503, 'vercel_not_configured', 'Vercel is not set up on Assurly yet.');
    }

    let installation;
    try {
      installation = await exchangeIntegrationCode(query.code, config);
    } catch (error) {
      if (error instanceof VercelApiError) {
        throw new ApiError(502, 'vercel_token_failed', 'Vercel did not accept the connection.');
      }
      throw error;
    }
    if (query.configurationId && query.configurationId !== installation.configurationId) {
      throw new ApiError(400, 'invalid_request', 'Vercel connection state is not valid.');
    }

    const admin = getAdminDbAdapter();
    await admin.upsertVercelConnection(
      organization.id,
      installation.teamId,
      installation.configurationId,
      encryptVercelToken(installation.accessToken),
    );

    const target = await context.db.getTargetById(state.targetId);
    let status = 'connected';
    if (target && target.organization_id === organization.id) {
      const result = await linkLiveLockProject({
        target,
        api: createVercelIntegrationApi(installation.accessToken, installation.teamId),
        teamId: installation.teamId,
        chosenProjectId: null,
        existing: await admin.getLiveLockProject(target.id),
        installUrl: null,
        save: (input) => admin.upsertLiveLockProject(input),
      });
      status = result.status;
    }

    const next = vercelNext(query.next);
    if (next) return NextResponse.redirect(next);
    return NextResponse.redirect(
      `${getApplicationUrl()}/dashboard?liveLock=${encodeURIComponent(status)}`,
    );
  },
);
