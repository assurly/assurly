import { NextResponse } from 'next/server';
import {
  emptyBodySchema,
  emptyObjectSchema,
  RATE_LIMITS,
  secureRoute,
} from '../../../../utils/apiSecurity';

export const GET = secureRoute(
  {
    routeId: 'auth:session',
    auth: 'optional',
    query: emptyObjectSchema,
    params: emptyObjectSchema,
    body: emptyBodySchema,
    bodyMode: 'none',
    maxBodyBytes: 0,
    rateLimit: RATE_LIMITS.read,
  },
  async ({ auth }) => {
    if (!auth) {
      return NextResponse.json({ user: null, organization: null, repositories: [] });
    }
    const organization = await auth.db.getOrganizationByUserId(auth.user.id);
    const repositories = organization ? await auth.db.getRepositories(organization.id) : [];
    return NextResponse.json({ user: auth.user, organization, repositories });
  },
);
