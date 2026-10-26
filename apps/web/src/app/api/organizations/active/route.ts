import { NextResponse } from 'next/server';
import { z } from 'zod';
import {
  ApiError,
  emptyObjectSchema,
  RATE_LIMITS,
  requireRouteUser,
  secureRoute,
} from '../../../../utils/apiSecurity';

const selectBody = z.object({ organizationId: z.uuid() }).strict();

/**
 * Switches the active workspace. The database only updates the caller's own
 * membership, so naming another organization changes nothing and answers 404.
 */
export const POST = secureRoute(
  {
    routeId: 'organizations:select',
    auth: 'required',
    csrf: true,
    query: emptyObjectSchema,
    params: emptyObjectSchema,
    body: selectBody,
    bodyMode: 'json',
    maxBodyBytes: 256,
    rateLimit: RATE_LIMITS.write,
  },
  async ({ auth, body }) => {
    const context = requireRouteUser(auth);
    if (!(await context.db.selectOrganization(body.organizationId))) {
      throw new ApiError(404, 'not_found', 'Workspace not found.');
    }
    return NextResponse.json({ activeId: body.organizationId });
  },
);
