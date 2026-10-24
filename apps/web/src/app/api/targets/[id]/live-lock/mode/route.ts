import { NextResponse } from 'next/server';
import { z } from 'zod';
import {
  ApiError,
  emptyObjectSchema,
  RATE_LIMITS,
  requireRouteUser,
  secureRoute,
} from '../../../../../../utils/apiSecurity';
import { requireOrganizationMember } from '../../../../../../utils/authorization';
import { getAdminDbAdapter } from '../../../../../../utils/dbAdapter';

const targetParams = z.object({ id: z.string().uuid() }).strict();

const modeBody = z.object({ mode: z.enum(['monitor', 'enforce', 'off']) }).strict();

/**
 * Monitor reports on every production deploy and never holds one. Enforce
 * holds a deploy whose fresh check finds a blocker. Off removes the lock; the
 * Vercel installation stays until the user removes it in Vercel. A change
 * applies from the next deployment Vercel creates.
 */
export const POST = secureRoute(
  {
    routeId: 'targets:live-lock:mode',
    auth: 'required',
    csrf: true,
    query: emptyObjectSchema,
    params: targetParams,
    body: modeBody,
    bodyMode: 'json',
    maxBodyBytes: 256,
    rateLimit: RATE_LIMITS.sensitive,
  },
  async ({ auth, params, body }) => {
    const context = requireRouteUser(auth);
    const organization = await context.db.getOrganizationByUserId(context.user.id);
    if (!organization) throw new ApiError(404, 'not_found', 'Target not found.');
    await requireOrganizationMember(context, organization.id);

    const target = await context.db.getTargetById(params.id);
    if (!target || target.organization_id !== organization.id || target.kind !== 'url') {
      throw new ApiError(404, 'not_found', 'Target not found.');
    }

    const admin = getAdminDbAdapter();
    if (body.mode === 'off') {
      await admin.deleteLiveLockProject(target.id);
      return NextResponse.json({ mode: null });
    }
    const row = await admin.setLiveLockMode(target.id, body.mode);
    if (!row) throw new ApiError(404, 'not_found', 'Live Lock is not on for this URL.');
    return NextResponse.json({ mode: row.mode });
  },
);
