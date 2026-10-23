import crypto from 'node:crypto';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import {
  ApiError,
  RATE_LIMITS,
  requireRouteUser,
  secureRoute,
} from '../../../../utils/apiSecurity';
import { requireScanAccess } from '../../../../utils/authorization';
import { getApplicationUrl } from '../../../../utils/env';
import { planAllowsShareableReports } from '../../../../utils/entitlements';

const shareBody = z
  .object({
    scanId: z.string().uuid(),
  })
  .strict();

export const POST = secureRoute(
  {
    routeId: 'scans:share',
    auth: 'required',
    query: z.object({}).strict(),
    params: z.object({}).strict(),
    body: shareBody,
    bodyMode: 'json',
    maxBodyBytes: 4096,
    rateLimit: RATE_LIMITS.write,
    csrf: true,
  },
  async ({ auth, body }) => {
    const context = requireRouteUser(auth);
    const organization = await context.db.getOrganizationByUserId(context.user.id);
    if (!organization || !planAllowsShareableReports(organization.billing_plan)) {
      throw new ApiError(
        403,
        'plan_required',
        'Shareable Ship Gate reports are available on Pro and OEM plans.',
      );
    }

    await requireScanAccess(context, body.scanId);
    const existing = await context.db.getScan(body.scanId);
    if (!existing) throw new ApiError(404, 'not_found', 'Scan not found.');

    const shareToken = existing.share_token || crypto.randomBytes(16).toString('hex');
    let scan = existing;
    if (!existing.share_token) {
      try {
        scan = await context.db.setScanShareToken(body.scanId, shareToken);
      } catch (error: unknown) {
        const detail = error instanceof Error ? error.message : String(error);
        // Two distinct ways the environment can lack share support, both of which
        // must degrade to an actionable message rather than a bare 500:
        //   * the `share_token` COLUMN is missing (20260626120000 not applied)
        //   * the UPDATE grant/policy is missing (20260720000000 not applied) —
        //     Postgres answers "permission denied", or RLS filters the row out
        //     and the adapter reports that no row matched.
        if (
          /share_token|column|schema cache|permission denied|row-level security|matched no scan row/i.test(
            detail,
          )
        ) {
          throw new ApiError(
            503,
            'share_unavailable',
            'Shareable reports are not enabled on this environment yet. Apply the latest database migration.',
          );
        }
        throw error;
      }
    }

    const baseUrl = getApplicationUrl().replace(/\/$/, '');
    return NextResponse.json({
      token: scan.share_token,
      url: `${baseUrl}/report/${scan.share_token}`,
    });
  },
);

/**
 * Every live share link in the caller's workspace, so a link handed out months
 * ago can be found and stopped. Not plan-gated: a workspace that dropped to a
 * plan without sharing must still see what it shared.
 */
export const GET = secureRoute(
  {
    routeId: 'scans:share:list',
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
    if (!organization) throw new ApiError(404, 'not_found', 'Workspace not found.');

    const baseUrl = getApplicationUrl().replace(/\/$/, '');
    const shared = await context.db.getSharedScans(organization.id);
    return NextResponse.json({
      shares: shared.map((scan) => ({
        scanId: scan.id,
        repositoryName: scan.repositories.name,
        branch: scan.branch,
        commitSha: scan.commit_sha,
        verdict: scan.verdict,
        shipScore: scan.ship_score,
        createdAt: scan.created_at,
        url: `${baseUrl}/report/${scan.share_token}`,
      })),
    });
  },
);

/**
 * Stops sharing a scan. The report link and the README badge built on the same
 * token stop resolving at once; sharing again mints a new token, so the old
 * link never comes back. Never plan-gated: anyone who could share must always
 * be able to unshare.
 */
export const DELETE = secureRoute(
  {
    routeId: 'scans:share:revoke',
    auth: 'required',
    query: z.object({}).strict(),
    params: z.object({}).strict(),
    body: shareBody,
    bodyMode: 'json',
    maxBodyBytes: 4096,
    rateLimit: RATE_LIMITS.write,
    csrf: true,
  },
  async ({ auth, body }) => {
    const context = requireRouteUser(auth);
    await requireScanAccess(context, body.scanId);
    const scan = await context.db.getScan(body.scanId);
    if (!scan) throw new ApiError(404, 'not_found', 'Scan not found.');

    if (scan.share_token) await context.db.clearScanShareToken(body.scanId);
    return NextResponse.json({ revoked: true });
  },
);
