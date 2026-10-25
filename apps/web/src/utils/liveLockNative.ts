import type { DbAdapter, LiveLockResourceRow, Target, VercelInstallationRow } from './dbAdapter';
import type { DeploymentProbeResult } from './liveLock';
import {
  conclusionFor,
  type DeploymentCheckOutcome,
  type IntegrationEvent,
  type LiveLockMode,
} from './liveLockCheck';
import {
  probeThroughProtection,
  type DeploymentCheckDeps,
  type DeploymentCheckRun,
} from './liveLockDeploymentCheck';
import type { VercelIntegrationApi } from './vercelIntegration';
import type { VercelMarketplaceApi } from './vercelMarketplaceApi';

/**
 * Live Lock for native Marketplace installations. The team connects a Live
 * Lock resource to a project in Vercel; Assurly answers with a project check,
 * and Vercel starts a check run on every production deployment.
 *
 * The rules are the ones the v1 path follows: the payload never chooses what
 * is probed (the deployment is read back with the installation's own token and
 * must belong to the connected project), and anything Assurly cannot decide
 * concludes neutral, so a deploy is only ever held for a proven blocker.
 */

type ConnectEvent = Extract<IntegrationEvent, { type: 'integration-resource.project-connected' }>;
type DisconnectEvent = Extract<
  IntegrationEvent,
  { type: 'integration-resource.project-disconnected' }
>;
type CheckRunEvent = Extract<IntegrationEvent, { type: 'deployment.checkrun.start' }>;

const RESOURCE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface NativeLockDeps extends Pick<
  DeploymentCheckDeps,
  'probe' | 'bypass' | 'onBypassError' | 'detailsUrl'
> {
  db: DbAdapter;
  decryptToken: (ciphertext: string) => string;
  marketplaceApiFor: (token: string) => VercelMarketplaceApi;
  integrationApiFor: (
    token: string,
  ) => Pick<VercelIntegrationApi, 'createProtectionBypass' | 'revokeProtectionBypass'>;
}

interface Linked {
  installation: VercelInstallationRow;
  resource: LiveLockResourceRow;
  token: string;
}

async function linkedResource(
  installationId: string,
  resourceId: string,
  deps: NativeLockDeps,
): Promise<Linked | null> {
  if (!RESOURCE_ID.test(resourceId)) return null;
  const installation = await deps.db.getVercelInstallation(installationId);
  if (!installation) return null;
  const resource = await deps.db.getLiveLockResource(installationId, resourceId);
  if (!resource || resource.organization_id !== installation.organization_id) return null;
  return { installation, resource, token: deps.decryptToken(installation.token_ciphertext) };
}

/** Enforce only blocks while the installation is on Pro. */
function effectiveMode(linked: Linked): LiveLockMode {
  return linked.resource.mode === 'enforce' && linked.installation.billing_plan_id === 'pro'
    ? 'enforce'
    : 'monitor';
}

export type ConnectResult =
  | 'connected'
  | 'already_connected'
  | 'unknown_resource'
  | 'resource_in_use'
  | 'project_taken'
  | 'no_domain';

/**
 * `integration-resource.project-connected`. One Live Lock guards one project:
 * its production domain becomes a url target whose ownership Vercel attested
 * (the signed event says this team connected this project), and a project
 * check is created so Vercel runs Assurly on each production deployment.
 */
export async function connectResource(
  event: ConnectEvent,
  deps: NativeLockDeps,
): Promise<ConnectResult> {
  const linked = await linkedResource(event.installationId, event.resourceId, deps);
  if (!linked) return 'unknown_resource';
  const { installation, resource } = linked;
  if (resource.vercel_project_id === event.projectId && resource.vercel_check_id) {
    return 'already_connected';
  }
  if (resource.vercel_project_id && resource.vercel_project_id !== event.projectId) {
    return 'resource_in_use';
  }
  if (!event.productionOrigin) return 'no_domain';

  const existing = await deps.db.getLiveLockProjectByVercelProject(event.projectId);
  if (existing?.resource_id && existing.resource_id !== resource.resource_id) {
    return 'project_taken';
  }
  // A lock made through the older connectable install gives way to this one.
  if (existing && !existing.resource_id) await deps.db.deleteLiveLockProject(existing.target_id);

  const target = await deps.db.upsertTarget({
    organizationId: installation.organization_id,
    kind: 'url',
    identifier: event.productionOrigin,
    displayName: event.projectName,
  });
  await deps.db.setTargetOwnership(target.id, {
    ownershipVerified: true,
    ownershipMethod: 'vercel_project',
  });

  const mode = effectiveMode(linked);
  const check = await deps.marketplaceApiFor(linked.token).createProjectCheck(event.projectId, {
    resourceId: resource.resource_id,
    blocking: mode === 'enforce',
  });
  await deps.db.updateLiveLockResource(resource.installation_id, resource.resource_id, {
    vercel_project_id: event.projectId,
    target_id: target.id,
    vercel_check_id: check.id,
  });
  await deps.db.upsertLiveLockProject({
    organizationId: installation.organization_id,
    targetId: target.id,
    vercelProjectId: event.projectId,
    vercelProjectName: event.projectName,
    vercelTeamId: null,
    mode: resource.mode,
    resourceId: resource.resource_id,
  });
  return 'connected';
}

/**
 * `integration-resource.project-disconnected`. The project check and the
 * bypass go; the url target and its history stay in the dashboard.
 */
export async function disconnectResource(
  event: DisconnectEvent,
  deps: NativeLockDeps,
): Promise<boolean> {
  const linked = await linkedResource(event.installationId, event.resourceId, deps);
  if (!linked || linked.resource.vercel_project_id !== event.projectId) return false;
  const { resource } = linked;

  if (resource.vercel_check_id) {
    await deps
      .marketplaceApiFor(linked.token)
      .deleteProjectCheck(event.projectId, resource.vercel_check_id)
      // Vercel drops a disconnected resource's check itself; ours is a courtesy.
      .catch(() => undefined);
  }
  if (resource.target_id) {
    const stored = await deps.db.getLiveLockBypass(resource.target_id).catch(() => null);
    if (stored?.vercel_project_id === event.projectId) {
      await deps
        .integrationApiFor(linked.token)
        .revokeProtectionBypass(event.projectId, deps.decryptToken(stored.secret_ciphertext))
        .catch(() => undefined);
    }
    await deps.db.deleteLiveLockBypass(resource.target_id);
    await deps.db.deleteLiveLockProject(resource.target_id);
  }
  await deps.db.updateLiveLockResource(resource.installation_id, resource.resource_id, {
    vercel_project_id: null,
    target_id: null,
    vercel_check_id: null,
  });
  return true;
}

const SUMMARY_LIMIT = 200;

/** One line for the check run in the Vercel dashboard. */
export function checkRunSummary(mode: LiveLockMode, result: DeploymentProbeResult): string {
  const first = result.blockers[0];
  const count = result.blockers.length;
  const blockers = `${count} proven blocker${count === 1 ? '' : 's'}${first ? `: ${first.message}` : ''}`;
  const text: Record<DeploymentCheckOutcome, string> = {
    clear: 'No proven blocker on the live deployment.',
    runtime_blocker:
      mode === 'enforce' ? `Held back. ${blockers}` : `Monitor mode, would hold back. ${blockers}`,
    deployment_protected: 'Not verified: Deployment Protection kept the check out.',
    probe_refused: 'Not verified: the deployment refused the check.',
    probe_unavailable: 'Not verified: the deployment did not answer in time.',
    ownership_unverified: 'Not verified: this deployment is not the guarded project.',
  };
  return text[result.outcome].slice(0, SUMMARY_LIMIT);
}

/**
 * `deployment.checkrun.start`. Marks the run running inside the webhook's 30
 * seconds and returns the probe for the background. When the run cannot be
 * tied to a guarded project it is concluded neutral right away, so Vercel is
 * never left waiting on Assurly.
 */
export async function startCheckRun(
  event: CheckRunEvent,
  deps: NativeLockDeps,
): Promise<DeploymentCheckRun | null> {
  const linked = await linkedResource(event.installationId, event.resourceId, deps);
  if (!linked) return null;
  const api = deps.marketplaceApiFor(linked.token);
  const detailsUrl = deps.detailsUrl(linked.resource.target_id ?? '');
  const release = (outcome: DeploymentCheckOutcome) =>
    api.updateCheckRun(event.deploymentId, event.checkRunId, {
      status: 'completed',
      conclusion: 'neutral',
      conclusionText: checkRunSummary('monitor', { outcome, shipScore: null, blockers: [] }),
      externalUrl: detailsUrl,
    });

  const { resource } = linked;
  const target: Target | null = resource.target_id
    ? await deps.db.getTargetById(resource.target_id)
    : null;
  if (
    !target ||
    target.organization_id !== resource.organization_id ||
    !resource.vercel_project_id
  ) {
    await release('ownership_unverified');
    return null;
  }
  // Read back with our own token: the deployment must be a production build
  // of the connected project, and its URL is Vercel's generated one.
  const deployment = await api.getDeployment(event.deploymentId).catch(() => null);
  if (
    !deployment ||
    !deployment.production ||
    deployment.projectId !== resource.vercel_project_id
  ) {
    await release('ownership_unverified');
    return null;
  }

  const mode = effectiveMode(linked);
  const row = await deps.db.registerLiveLockCheck({
    organizationId: resource.organization_id,
    targetId: target.id,
    vercelProjectId: deployment.projectId,
    deploymentId: deployment.id,
    deploymentUrl: deployment.url,
    gitSha: deployment.gitSha,
    blocking: mode === 'enforce',
    source: 'check_run',
    checkId: event.checkRunId,
  });
  if (row.vercel_check_id !== event.checkRunId) {
    await deps.db.setLiveLockCheckRun(deployment.id, event.checkRunId);
  }
  const claimed = await deps.db.claimLiveLockCheckRun(deployment.id);
  if (!claimed) return null;

  try {
    await api.updateCheckRun(deployment.id, event.checkRunId, { status: 'running' });
  } catch (error) {
    // Give the run back, so Vercel's redelivery can claim it.
    await deps.db.completeLiveLockCheck(deployment.id, claimed.run, {
      conclusion: 'neutral',
      reason: 'probe_unavailable',
      shipScore: null,
      blockers: [],
    });
    throw error;
  }

  return async () => {
    let result: DeploymentProbeResult;
    try {
      result = await probeThroughProtection(claimed, target, deps, () =>
        deps
          .integrationApiFor(linked.token)
          .createProtectionBypass(claimed.vercel_project_id, resource.installation_id),
      );
    } catch {
      result = { outcome: 'probe_unavailable', shipScore: null, blockers: [] };
    }
    const conclusion = conclusionFor(mode, result.outcome);
    await deps.db.completeLiveLockCheck(deployment.id, claimed.run, {
      conclusion,
      reason: result.outcome,
      shipScore: result.shipScore,
      blockers: result.blockers,
    });
    const update = {
      status: 'completed' as const,
      conclusion,
      conclusionText: checkRunSummary(mode, result),
      externalUrl: detailsUrl,
    };
    try {
      await api.updateCheckRun(deployment.id, event.checkRunId, update);
    } catch {
      await api.updateCheckRun(deployment.id, event.checkRunId, update);
    }
  };
}
