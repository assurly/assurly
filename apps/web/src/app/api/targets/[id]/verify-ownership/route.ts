import { NextResponse } from 'next/server';
import { z } from 'zod';
import {
  ApiError,
  RATE_LIMITS,
  requireRouteUser,
  secureRoute,
} from '../../../../../utils/apiSecurity';
import {
  OWNERSHIP_FILE_PATH,
  OWNERSHIP_META_NAME,
  OWNERSHIP_TXT_PREFIX,
  deriveOwnershipToken,
  verifyOwnership,
  type OwnershipChallengeMethod,
} from '../../../../../utils/ownership';
import type { DbAdapter, Target } from '../../../../../utils/dbAdapter';

const targetParams = z.object({ id: z.string().uuid() }).strict();

const verifyBody = z
  .object({
    method: z.enum(['meta_tag', 'dns_txt', 'file']),
  })
  .strict();

/**
 * Loads a `url` target the caller's organization owns. RLS already scopes the
 * read to the caller's org (via the user token), so a missing row is reported
 * as 404. Ownership challenges only apply to `url` targets — `repo` targets are
 * implicitly owned through the GitHub App.
 */
async function loadUrlTarget(db: DbAdapter, id: string): Promise<Target> {
  const target = await db.getTargetById(id);
  if (!target) throw new ApiError(404, 'not_found', 'Target not found.');
  if (target.kind !== 'url') {
    throw new ApiError(
      400,
      'invalid_target',
      'Ownership verification only applies to URL targets.',
    );
  }
  return target;
}

/** The public challenge instructions for one target (used by the verify UI). */
function challengeInstructions(token: string): {
  token: string;
  metaTag: string;
  metaName: string;
  dnsRecord: string;
  filePath: string;
} {
  return {
    token,
    metaTag: `<meta name="${OWNERSHIP_META_NAME}" content="${token}">`,
    metaName: OWNERSHIP_META_NAME,
    dnsRecord: `${OWNERSHIP_TXT_PREFIX}${token}`,
    filePath: OWNERSHIP_FILE_PATH,
  };
}

/** Issues (returns) the ownership challenge for a target the caller owns. */
export const GET = secureRoute(
  {
    routeId: 'targets:ownership-issue',
    auth: 'required',
    query: z.object({}).strict(),
    params: targetParams,
    body: z.undefined(),
    bodyMode: 'none',
    maxBodyBytes: 0,
    rateLimit: RATE_LIMITS.read,
  },
  async ({ auth, params }) => {
    const context = requireRouteUser(auth);
    const target = await loadUrlTarget(context.db, params.id);
    const token = deriveOwnershipToken({
      organizationId: target.organization_id,
      targetId: target.id,
      identifier: target.identifier,
    });
    return NextResponse.json({
      verified: target.ownership_verified,
      ownershipMethod: target.ownership_method,
      identifier: target.identifier,
      challenge: challengeInstructions(token),
    });
  },
);

/**
 * Runs the requested ownership challenge and, only on success, persists
 * `ownership_verified = true`. All host fetches go through the SSRF-safe,
 * GET-only path inside `verifyOwnership`.
 */
export const POST = secureRoute(
  {
    routeId: 'targets:ownership-verify',
    auth: 'required',
    query: z.object({}).strict(),
    params: targetParams,
    body: verifyBody,
    bodyMode: 'json',
    maxBodyBytes: 2 * 1024,
    rateLimit: RATE_LIMITS.sensitive,
    csrf: true,
  },
  async ({ auth, params, body }) => {
    const context = requireRouteUser(auth);
    const target = await loadUrlTarget(context.db, params.id);
    const method: OwnershipChallengeMethod = body.method;
    const token = deriveOwnershipToken({
      organizationId: target.organization_id,
      targetId: target.id,
      identifier: target.identifier,
    });

    const verified = await verifyOwnership(method, target.identifier, token);
    if (!verified) {
      return NextResponse.json({
        verified: false,
        method,
        challenge: challengeInstructions(token),
      });
    }

    const updated = await context.db.setTargetOwnership(target.id, {
      ownershipVerified: true,
      ownershipMethod: method,
    });
    return NextResponse.json({
      verified: true,
      method,
      ownershipMethod: updated.ownership_method,
    });
  },
);
