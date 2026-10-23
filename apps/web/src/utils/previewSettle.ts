import type { DbAdapter, Target } from './dbAdapter';
import { runLiveLock } from './liveLock';
import { decidePreviewLock, type PreviewDeploymentFacts } from './liveLockPreview';
import type { ScanLiveUrlFn } from './reprobe';

export type PreviewSettleResult = 'ignored' | 'refused' | 'blocked' | 'promoted';

/**
 * Runs Live Lock on a preview and creates the production deployment only when
 * that check is ready. A refused or blocked check does not promote.
 */
export async function settlePreviewDeployment(options: {
  target: Target;
  linkedProjectId: string;
  deployment: PreviewDeploymentFacts;
  db: DbAdapter;
  promote: (deploymentId: string) => Promise<void>;
  scanImpl?: ScanLiveUrlFn;
  fetchImpl?: typeof fetch;
}): Promise<PreviewSettleResult> {
  const decision = decidePreviewLock({
    linkedProjectId: options.linkedProjectId,
    deployment: options.deployment,
  });
  if (decision.action === 'ignore') return 'ignored';
  if (decision.action === 'refuse') {
    if (options.deployment.gitSha && /^[0-9a-f]{7,64}$/i.test(options.deployment.gitSha)) {
      await options.db.insertLiveLockAttempt({
        organizationId: options.target.organization_id,
        targetId: options.target.id,
        gitSha: options.deployment.gitSha.toLowerCase(),
        attemptId: options.deployment.deploymentId,
        status: 'blocked',
        shipScore: 0,
        reason: 'probe_refused',
      });
    }
    return 'refused';
  }

  const result = await runLiveLock({
    target: options.target,
    gitSha: decision.gitSha,
    attemptId: decision.attemptId,
    db: options.db,
    scanImpl: options.scanImpl,
    fetchImpl: options.fetchImpl,
    preview: {
      projectId: options.linkedProjectId,
      deploymentProjectId: options.deployment.projectId ?? '',
      previewUrl: decision.previewUrl,
    },
  });
  if (result.status !== 'ready') return 'blocked';
  await options.promote(decision.attemptId);
  return 'promoted';
}
