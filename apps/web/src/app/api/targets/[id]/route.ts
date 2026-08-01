import { NextResponse } from 'next/server';
import { z } from 'zod';
import {
  ApiError,
  emptyObjectSchema,
  RATE_LIMITS,
  requireRouteUser,
  secureRoute,
} from '../../../../utils/apiSecurity';
import { getAdminDbAdapter } from '../../../../utils/dbAdapter';

const idParams = z.object({ id: z.string().uuid() }).strict();

/**
 * Remove a guarded URL app from "Your apps". Repo targets are derived from the
 * connected GitHub installation — disconnect the repository instead of deleting
 * the projection row.
 *
 * Authz is enforced with the caller's org membership first; the delete itself
 * runs with the service role so it works even before the additive DELETE RLS
 * grant is applied (and remains correct after it is).
 */
export const DELETE = secureRoute(
  {
    routeId: 'targets:delete',
    auth: 'required',
    csrf: true,
    query: emptyObjectSchema,
    params: idParams,
    body: z.undefined(),
    bodyMode: 'none',
    maxBodyBytes: 0,
    rateLimit: RATE_LIMITS.write,
  },
  async ({ auth, params }) => {
    const context = requireRouteUser(auth);
    const organization = await context.db.getOrganizationByUserId(context.user.id);
    if (!organization) throw new ApiError(404, 'not_found', 'Target not found.');

    const target = await context.db.getTargetById(params.id);
    if (!target || target.organization_id !== organization.id) {
      throw new ApiError(404, 'not_found', 'Target not found.');
    }
    if (target.kind !== 'url') {
      throw new ApiError(
        400,
        'invalid_target',
        'Repository apps are removed by disconnecting the GitHub App installation, not by deleting the verdict card.',
      );
    }

    try {
      await getAdminDbAdapter().deleteTarget(target.id);
    } catch (error) {
      console.error('[Assurly] targets:delete failed:', (error as Error).message);
      throw new ApiError(500, 'delete_failed', 'Could not remove that URL app. Try again.');
    }
    return NextResponse.json({ deleted: true });
  },
);
