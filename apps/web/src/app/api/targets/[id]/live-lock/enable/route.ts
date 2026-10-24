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
import { linkLiveLockProject, setupResult } from '../../../../../../utils/enableLiveLock';
import {
  createVercelIntegrationApi,
  getVercelIntegrationConfig,
  vercelIntegrationInstallUrl,
} from '../../../../../../utils/vercelIntegration';
import { signVercelInstallState } from '../../../../../../utils/vercelInstallState';
import { decryptVercelToken } from '../../../../../../utils/vercelToken';

const targetParams = z.object({ id: z.string().uuid() }).strict();

const enableBody = z
  .object({
    vercelProjectId: z
      .string()
      .regex(/^[A-Za-z0-9_-]{1,64}$/)
      .optional(),
  })
  .strict();

/**
 * Turns Live Lock on for a verified URL. Without a Vercel installation it
 * returns the install link; with one it locks the project that serves the
 * URL, or lists the workspace's projects when none does. Nothing secret is
 * returned.
 */
export const POST = secureRoute(
  {
    routeId: 'targets:live-lock:enable',
    auth: 'required',
    csrf: true,
    query: emptyObjectSchema,
    params: targetParams,
    body: enableBody,
    bodyMode: 'json',
    maxBodyBytes: 512,
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
    if (!target.ownership_verified) return NextResponse.json(setupResult('ownership_required'));

    const config = getVercelIntegrationConfig();
    if (!config) return NextResponse.json(setupResult('vercel_not_configured'));
    const installUrl = vercelIntegrationInstallUrl(
      config.slug,
      signVercelInstallState({ organizationId: organization.id, targetId: target.id }),
    );

    const admin = getAdminDbAdapter();
    const connection = await admin.getVercelConnection(organization.id);
    let token: string | null = null;
    try {
      token = connection ? decryptVercelToken(connection.token_ciphertext) : null;
    } catch {
      token = null;
    }
    if (!connection || !token) {
      return NextResponse.json(setupResult('vercel_required', { installUrl }));
    }

    const result = await linkLiveLockProject({
      target,
      api: createVercelIntegrationApi(token, connection.team_id),
      teamId: connection.team_id,
      chosenProjectId: body.vercelProjectId ?? null,
      existing: await admin.getLiveLockProject(target.id),
      installUrl,
      save: (input) => admin.upsertLiveLockProject(input),
    });
    return NextResponse.json(result);
  },
);
