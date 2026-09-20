import { NextResponse } from 'next/server';
import { z } from 'zod';
import { RATE_LIMITS, requireRouteUser, secureRoute } from '../../../../utils/apiSecurity';
import { countVisibleScanHistoryByRepository } from '../../../../utils/scanHistoryDisplay';

/**
 * Visible scan-history count for every repository in the caller's
 * organization, in one round trip. The Settings repo list is the only reader;
 * it used to issue one `/api/scans?repoId=` read per repository (full rows) to
 * derive the same numbers. Every organization repository is present so the
 * client can tell "zero scans" from "not loaded".
 */
export const GET = secureRoute(
  {
    routeId: 'repositories:scan-counts',
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
    if (!organization) return NextResponse.json({ counts: {} });

    const repoIds = (await context.db.getRepositories(organization.id)).map((repo) => repo.id);
    const visible = countVisibleScanHistoryByRepository(
      await context.db.listScanHistoryRows(repoIds),
    );
    // Keyed by the organization's own repositories only — a row for any other
    // id (which RLS should already have hidden) never reaches the response.
    const counts = Object.fromEntries(repoIds.map((id) => [id, visible[id] ?? 0]));
    return NextResponse.json({ counts });
  },
);
