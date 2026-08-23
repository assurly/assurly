import { NextResponse } from 'next/server';
import { z } from 'zod';
import {
  ApiError,
  RATE_LIMITS,
  requireRouteUser,
  secureRoute,
} from '../../../../utils/apiSecurity';
import { requireRepositoryAccess } from '../../../../utils/authorization';
import { getAdminDbAdapter } from '../../../../utils/dbAdapter';

const repositoryParams = z
  .object({
    id: z.string().uuid(),
  })
  .strict();

const patchBody = z
  .object({
    scanCapability: z.enum(['browser', 'cli_only', 'invalid']).optional(),
    /** Only un-hiding is accepted here; hiding is DELETE. */
    dismissed: z.literal(false).optional(),
  })
  .strict()
  .refine((body) => body.scanCapability !== undefined || body.dismissed !== undefined, {
    message: 'At least one field is required.',
  });

/** Update scan capability, or restore a repository the user hid from Your apps. */
export const PATCH = secureRoute(
  {
    routeId: 'repositories:patch',
    auth: 'required',
    query: z.object({}).strict(),
    params: repositoryParams,
    body: patchBody,
    bodyMode: 'json',
    maxBodyBytes: 4 * 1024,
    rateLimit: RATE_LIMITS.write,
    csrf: true,
  },
  async ({ auth, params, body }) => {
    const context = requireRouteUser(auth);
    await requireRepositoryAccess(context, params.id);
    if (body.scanCapability) {
      await context.db.updateRepositoryScanCapability(params.id, body.scanCapability);
    }
    if (body.dismissed === false) {
      await getAdminDbAdapter().undismissRepository(params.id);
    }
    const repository = await context.db.getRepository(params.id);
    if (!repository) throw new ApiError(404, 'not_found', 'Repository not found.');
    return NextResponse.json(repository);
  },
);

/** Hide a repository from Your apps. Scan history is kept; Connect & Scan restores it. */
export const DELETE = secureRoute(
  {
    routeId: 'repositories:delete',
    auth: 'required',
    query: z.object({}).strict(),
    params: repositoryParams,
    body: z.undefined(),
    bodyMode: 'none',
    maxBodyBytes: 0,
    rateLimit: RATE_LIMITS.write,
    csrf: true,
  },
  async ({ auth, params }) => {
    const context = requireRouteUser(auth);
    await requireRepositoryAccess(context, params.id);
    try {
      await getAdminDbAdapter().deleteRepository(params.id);
    } catch (error) {
      console.error('[Assurly] repositories:delete failed:', (error as Error).message);
      throw new ApiError(500, 'delete_failed', 'Could not remove that repository. Try again.');
    }
    return NextResponse.json({ deleted: true });
  },
);
