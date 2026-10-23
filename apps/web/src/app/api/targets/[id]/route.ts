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
import { buildUrlTargetDetail } from '../../../../utils/urlTargetDetail';

const idParams = z.object({ id: z.string().uuid() }).strict();

/**
 * The proof behind a guarded URL's verdict: each blocker from the last check,
 * the redacted evidence the probe took, and whether a re-probe verified a fix.
 * Read-only — it shows what was recorded and never probes the app.
 */
export const GET = secureRoute(
  {
    routeId: 'targets:detail',
    auth: 'required',
    query: emptyObjectSchema,
    params: idParams,
    body: z.undefined(),
    bodyMode: 'none',
    maxBodyBytes: 0,
    rateLimit: RATE_LIMITS.read,
  },
  async ({ auth, params }) => {
    const context = requireRouteUser(auth);
    const organization = await context.db.getOrganizationByUserId(context.user.id);
    if (!organization) throw new ApiError(404, 'not_found', 'Target not found.');

    const target = await context.db.getTargetById(params.id);
    if (!target || target.organization_id !== organization.id || target.kind !== 'url') {
      throw new ApiError(404, 'not_found', 'Target not found.');
    }

    const admin = getAdminDbAdapter();
    const [evidence, outcomes, liveLock, project, repositories, connection] = await Promise.all([
      context.db.getLatestProbeEvidenceForTarget(target.id),
      context.db.getFixOutcomesForTarget(target.id),
      context.db.getLiveLockSummary(target.id),
      context.db.getLiveLockProject(target.id),
      context.db.getRepositories(organization.id),
      admin.getVercelConnection(organization.id).catch(() => null),
    ]);
    let origin = target.identifier;
    try {
      origin = new URL(target.identifier).origin;
    } catch {
      origin = target.identifier;
    }
    const linked = repositories.find((repo) => repo.homepage_url === origin && repo.is_active);
    return NextResponse.json(
      buildUrlTargetDetail(target, evidence, outcomes, liveLock, {
        repositoryName: linked?.name ?? null,
        vercelConnected: connection !== null,
        locked: project?.production_deploy_held === true,
        pullRequestUrl: project?.pull_request_url ?? null,
      }),
    );
  },
);

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
