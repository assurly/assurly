import { ApiError } from './apiSecurity';
import type { DbAdapter, Target } from './dbAdapter';
import { isActiveProbeAllowed } from './ownership';

/**
 * Loads a target the caller's org owns. Canaries require the same ownership
 * gate as active probes — repo via GitHub App, url via ownership_verified.
 */
export async function requireOwnedCanaryTarget(db: DbAdapter, id: string): Promise<Target> {
  const target = await db.getTargetById(id);
  if (!target) throw new ApiError(404, 'not_found', 'Target not found.');
  assertCanaryOwnership(target);
  return target;
}

export async function requireOwnedCanaryTargetByIdentifier(
  db: DbAdapter,
  organizationId: string,
  kind: Target['kind'],
  identifier: string,
): Promise<Target> {
  const target = await db.getTargetByIdentifier(organizationId, kind, identifier);
  if (!target) {
    throw new ApiError(404, 'not_found', 'Target not found.');
  }
  assertCanaryOwnership(target);
  return target;
}

function assertCanaryOwnership(target: Target): void {
  if (
    !isActiveProbeAllowed({
      kind: target.kind,
      ownershipVerified: target.ownership_verified,
    })
  ) {
    throw new ApiError(
      403,
      'ownership_required',
      'Verify ownership of this target before issuing a canary token.',
    );
  }
}
