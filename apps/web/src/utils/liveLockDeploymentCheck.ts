import type { DbAdapter, LiveLockCheckRow, Target, VercelConnectionRow } from './dbAdapter';
import type { DeploymentProbeResult } from './liveLock';
import { conclusionFor, type IntegrationEvent } from './liveLockCheck';
import { VercelApiError, type VercelIntegrationApi } from './vercelIntegration';

type DeploymentEvent = Extract<
  IntegrationEvent,
  { type: 'deployment.created' | 'deployment.ready' }
>;
type RerequestEvent = Extract<IntegrationEvent, { type: 'deployment.check-rerequested' }>;

export interface DeploymentCheckDeps {
  db: DbAdapter;
  /** Builds the REST client from a stored connection. The token stays inside. */
  apiFor: (connection: VercelConnectionRow) => VercelIntegrationApi;
  probe: (target: Target, deploymentUrl: string) => Promise<DeploymentProbeResult>;
  detailsUrl: (targetId: string) => string;
}

/** The background half of a run: probe, then conclude the Vercel check. */
export type DeploymentCheckRun = () => Promise<void>;

interface Linked {
  target: Target;
  api: VercelIntegrationApi;
}

/**
 * Ties a signed deployment event to a lock. The project id comes from the
 * signed webhook; the lock row says which verified URL that project serves.
 * A team that does not match the one the lock was made in is not trusted.
 */
async function resolveLock(
  projectId: string,
  teamId: string | null,
  deps: DeploymentCheckDeps,
): Promise<(Linked & { blocking: boolean }) | null> {
  const project = await deps.db.getLiveLockProjectByVercelProject(projectId);
  if (!project || project.vercel_team_id !== teamId) return null;
  const target = await deps.db.getTargetById(project.target_id);
  if (!target || target.kind !== 'url' || target.organization_id !== project.organization_id) {
    return null;
  }
  const connection = await deps.db.getVercelConnection(project.organization_id);
  if (!connection) return null;
  return { target, api: deps.apiFor(connection), blocking: project.mode === 'enforce' };
}

async function linkedForRow(
  row: LiveLockCheckRow,
  deps: DeploymentCheckDeps,
): Promise<Linked | null> {
  const target = await deps.db.getTargetById(row.target_id);
  if (!target || target.organization_id !== row.organization_id) return null;
  const connection = await deps.db.getVercelConnection(row.organization_id);
  if (!connection) return null;
  return { target, api: deps.apiFor(connection) };
}

/**
 * `deployment.created`: registers the check Vercel will wait for. Only
 * production deployments of a locked project get one. `blocking` follows the
 * lock's mode at this moment, so switching modes affects the next deploy.
 */
export async function registerDeploymentCheck(
  event: DeploymentEvent,
  deps: DeploymentCheckDeps,
): Promise<LiveLockCheckRow | null> {
  if (!event.production || !event.deploymentUrl) return null;
  const lock = await resolveLock(event.projectId, event.teamId, deps);
  if (!lock) return null;

  const row = await deps.db.registerLiveLockCheck({
    organizationId: lock.target.organization_id,
    targetId: lock.target.id,
    vercelProjectId: event.projectId,
    deploymentId: event.deploymentId,
    deploymentUrl: event.deploymentUrl,
    gitSha: event.gitSha,
    blocking: lock.blocking,
  });
  if (row.vercel_check_id) return row;

  let check: { id: string };
  try {
    check = await lock.api.createCheck(event.deploymentId, {
      blocking: row.blocking,
      detailsUrl: deps.detailsUrl(lock.target.id),
    });
  } catch (error) {
    // A 4xx will not change on redelivery (the deployment finished, or Vercel
    // rejects the request), so close the row as not verified instead of
    // leaving it waiting forever. A 5xx is thrown so Vercel retries.
    if (error instanceof VercelApiError && error.status >= 400 && error.status < 500) {
      await deps.db.completeLiveLockCheck(event.deploymentId, row.run, {
        conclusion: 'neutral',
        reason: 'probe_unavailable',
        shipScore: null,
        blockers: [],
      });
      return null;
    }
    throw error;
  }
  await deps.db.setLiveLockCheckId(event.deploymentId, check.id);
  return { ...row, vercel_check_id: check.id };
}

/**
 * `deployment.ready`: the build is done and Vercel waits for the conclusion.
 * Marks the check running now (inside the webhook's 30 seconds) and returns
 * the probe for the caller to run in the background. Null means there is
 * nothing to run: not locked, or another delivery already holds the run.
 */
export async function startDeploymentCheck(
  event: DeploymentEvent,
  deps: DeploymentCheckDeps,
): Promise<DeploymentCheckRun | null> {
  // Vercel does not promise order. A ready that arrives first registers too.
  const existing =
    (await deps.db.getLiveLockCheck(event.deploymentId)) ??
    (await registerDeploymentCheck(event, deps));
  if (!existing?.vercel_check_id) return null;
  return claimRun(existing.deployment_id, deps);
}

/** `deployment.check-rerequested`: the user pressed Rerun on our check. */
export async function rerunDeploymentCheck(
  event: RerequestEvent,
  deps: DeploymentCheckDeps,
): Promise<DeploymentCheckRun | null> {
  const row = await deps.db.getLiveLockCheck(event.deploymentId);
  if (!row || row.vercel_check_id !== event.checkId) return null;
  return claimRun(row.deployment_id, deps);
}

async function claimRun(
  deploymentId: string,
  deps: DeploymentCheckDeps,
): Promise<DeploymentCheckRun | null> {
  const claimed = await deps.db.claimLiveLockCheckRun(deploymentId);
  if (!claimed?.vercel_check_id) return null;
  const linked = await linkedForRow(claimed, deps);
  if (!linked) {
    // The lock went away between registration and now. Release the deploy.
    await deps.db.completeLiveLockCheck(deploymentId, claimed.run, {
      conclusion: 'neutral',
      reason: 'ownership_unverified',
      shipScore: null,
      blockers: [],
    });
    return null;
  }
  try {
    await linked.api.markCheckRunning(deploymentId, claimed.vercel_check_id);
  } catch (error) {
    // Give the run back, so Vercel's redelivery of this event can claim it.
    await deps.db.completeLiveLockCheck(deploymentId, claimed.run, {
      conclusion: 'neutral',
      reason: 'probe_unavailable',
      shipScore: null,
      blockers: [],
    });
    throw error;
  }
  return () => concludeRun(claimed, linked, deps);
}

async function concludeRun(
  row: LiveLockCheckRow,
  linked: Linked,
  deps: DeploymentCheckDeps,
): Promise<void> {
  const checkId = row.vercel_check_id;
  if (!checkId) return;
  let result: DeploymentProbeResult;
  try {
    result = await deps.probe(linked.target, row.deployment_url);
  } catch {
    result = { outcome: 'probe_unavailable', shipScore: null, blockers: [] };
  }
  const conclusion = conclusionFor(row.blocking ? 'enforce' : 'monitor', result.outcome);

  // The row is written first: if Vercel cannot be reached, the dashboard still
  // shows what Assurly saw, and the check goes stale in Vercel, not silent here.
  await deps.db.completeLiveLockCheck(row.deployment_id, row.run, {
    conclusion,
    reason: result.outcome,
    shipScore: result.shipScore,
    blockers: result.blockers,
  });
  const detailsUrl = deps.detailsUrl(linked.target.id);
  try {
    await linked.api.completeCheck(row.deployment_id, checkId, { conclusion, detailsUrl });
  } catch {
    await linked.api.completeCheck(row.deployment_id, checkId, { conclusion, detailsUrl });
  }
}
