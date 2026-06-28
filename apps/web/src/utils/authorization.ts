import type { AuthContext } from './auth';
import type { Membership, Organization, Repository, Scan, ScanFinding } from './dbAdapter';

export class AuthorizationError extends Error {
  readonly status = 404;

  constructor(message = 'Resource not found') {
    super(message);
    this.name = 'AuthorizationError';
  }
}

export async function requireOrganizationMember(
  context: AuthContext,
  organizationId: string,
): Promise<{ organization: Organization; membership: Membership }> {
  const [organization, membership] = await Promise.all([
    context.db.getOrganization(organizationId),
    context.db.getMembership(context.user.id, organizationId),
  ]);

  if (!organization || !membership) throw new AuthorizationError();
  return { organization, membership };
}

export async function requireRepositoryAccess(
  context: AuthContext,
  repositoryId: string,
): Promise<{ repository: Repository; organization: Organization; membership: Membership }> {
  const repository = await context.db.getRepository(repositoryId);
  if (!repository) throw new AuthorizationError('Repository not found');

  const access = await requireOrganizationMember(context, repository.organization_id);
  return { repository, ...access };
}

export async function requireScanAccess(
  context: AuthContext,
  scanId: string,
): Promise<{
  scan: Scan;
  repository: Repository;
  organization: Organization;
  membership: Membership;
}> {
  const scan = await context.db.getScan(scanId);
  if (!scan) throw new AuthorizationError('Scan not found');

  const access = await requireRepositoryAccess(context, scan.repository_id);
  return { scan, ...access };
}

export async function requireFindingAccess(
  context: AuthContext,
  findingId: string,
): Promise<{
  finding: ScanFinding;
  scan: Scan;
  repository: Repository;
  organization: Organization;
  membership: Membership;
}> {
  const finding = await context.db.getFinding(findingId);
  if (!finding) throw new AuthorizationError('Finding not found');

  const access = await requireScanAccess(context, finding.scan_id);
  return { finding, ...access };
}
