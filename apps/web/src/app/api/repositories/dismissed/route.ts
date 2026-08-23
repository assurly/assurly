import { NextResponse } from 'next/server';
import { z } from 'zod';
import { RATE_LIMITS, requireRouteUser, secureRoute } from '../../../../utils/apiSecurity';

/** Repos the user hid from Your apps, so Settings can offer Restore. */
export const GET = secureRoute(
  {
    routeId: 'repositories:dismissed',
    auth: 'required',
    query: z.object({}).strict(),
    params: z.object({}).strict(),
    body: z.undefined(),
    bodyMode: 'none',
    maxBodyBytes: 0,
    rateLimit: RATE_LIMITS.read,
  },
  async ({ auth }) => {
    const context = requireRouteUser(auth);
    const organization = await context.db.getOrganizationByUserId(context.user.id);
    if (!organization) return NextResponse.json({ repositories: [] });
    const repositories = await context.db.getDismissedRepositories(organization.id);
    return NextResponse.json({ repositories });
  },
);
