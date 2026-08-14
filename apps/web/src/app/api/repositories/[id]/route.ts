import { NextResponse } from 'next/server';
import { z } from 'zod';
import {
  ApiError,
  RATE_LIMITS,
  requireRouteUser,
  secureRoute,
} from '../../../../utils/apiSecurity';
import { requireRepositoryAccess } from '../../../../utils/authorization';

const repositoryParams = z
  .object({
    id: z.string().uuid(),
  })
  .strict();

const patchBody = z
  .object({
    scanCapability: z.enum(['browser', 'cli_only', 'invalid']).optional(),
  })
  .strict()
  .refine((body) => body.scanCapability !== undefined, {
    message: 'At least one field is required.',
  });

/** Update repository scan capability (e.g. after a too-large browser scan). */
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
    const repository = await context.db.getRepository(params.id);
    if (!repository) throw new ApiError(404, 'not_found', 'Repository not found.');
    return NextResponse.json(repository);
  },
);

/** Remove a repository the user can no longer scan meaningfully (invalid name, etc.). */
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
    await context.db.deleteRepository(params.id);
    return NextResponse.json({ deleted: true });
  },
);
