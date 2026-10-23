import { z } from 'zod';
import type { DbAdapter } from './dbAdapter';
import { scanPushedCommit, trackedBranch, type PushEvent, type PushScanDeps } from './pushScan';

const ZERO_SHA = /^0+$/;

const pushWebhookSchema = z
  .object({
    ref: z.string().min(1).max(300),
    after: z.string().regex(/^[0-9a-f]{40,64}$/),
    deleted: z.boolean().optional(),
    repository: z
      .object({
        id: z.number().int().positive().safe(),
        full_name: z
          .string()
          .min(3)
          .max(201)
          .regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/),
        default_branch: z.string().min(1).max(255),
      })
      .passthrough(),
    installation: z.object({ id: z.number().int().positive().safe() }).passthrough(),
    head_commit: z
      .object({ timestamp: z.string().max(64).optional() })
      .passthrough()
      .nullable()
      .optional(),
  })
  .passthrough();

export interface PushDeliveryResult {
  status: 200 | 202;
  message: string;
}

export interface PushDeliveryInput {
  rawPayload: unknown;
  deliveryId: string | null;
  db: DbAdapter;
  /** Schedules work after the response, like `after()` in the route. */
  runAfter: (work: () => Promise<void>) => void;
  requestId?: string;
  deps?: PushScanDeps;
  now?: () => Date;
}

function logPushScan(details: Record<string, unknown>): void {
  console.log(JSON.stringify({ service: 'assurly-api', route: 'github:webhook:push', ...details }));
}

function committedAt(timestamp: string | undefined, now: () => Date): string {
  const parsed = timestamp ? new Date(timestamp) : null;
  return parsed && !Number.isNaN(parsed.getTime()) ? parsed.toISOString() : now().toISOString();
}

/**
 * A push to the branch a repository ships from. Records the new head commit at
 * once — so every card, badge and report reads "code changed since this check"
 * from that moment — and then runs Full Gate on that commit in the
 * background. Pushes to any other branch are acknowledged and ignored.
 */
export async function handlePushDelivery(input: PushDeliveryInput): Promise<PushDeliveryResult> {
  const now = input.now ?? (() => new Date());
  const payload = pushWebhookSchema.parse(input.rawPayload);
  if (!payload.ref.startsWith('refs/heads/') || payload.deleted || ZERO_SHA.test(payload.after)) {
    return { status: 200, message: 'Push ignored.' };
  }

  const repository = await input.db.getRepositoryByGithubRepoId(payload.repository.id);
  if (!repository || !repository.is_active) {
    return { status: 200, message: 'Repository not connected.' };
  }

  const event: PushEvent = {
    repositoryName: payload.repository.full_name,
    githubRepositoryId: payload.repository.id,
    installationId: String(payload.installation.id),
    branch: payload.ref.slice('refs/heads/'.length),
    defaultBranch: payload.repository.default_branch,
    commitSha: payload.after,
  };
  const recentScans = await input.db.getRecentScans(repository.id);
  const { tracked, emptyDefaultBranch } = trackedBranch(event, recentScans);
  if (!tracked) return { status: 200, message: 'Branch not tracked.' };

  if (!input.deliveryId || !/^[A-Za-z0-9-]{1,100}$/.test(input.deliveryId)) {
    throw new Error('Invalid delivery ID.');
  }
  const deliveryId = input.deliveryId;
  const claimed = await input.db.claimGitHubDelivery(
    deliveryId,
    'push',
    event.githubRepositoryId,
    event.installationId,
  );
  if (!claimed) return { status: 200, message: 'Duplicate delivery ignored.' };

  await input.db.recordRepositoryHeadCommit(
    repository.id,
    event.commitSha,
    committedAt(payload.head_commit?.timestamp, now),
  );

  if (repository.scan_capability === 'invalid') {
    await input.db.finishGitHubDelivery(deliveryId, true);
    return { status: 202, message: 'Head commit recorded.' };
  }

  input.runAfter(async () => {
    try {
      const outcome = await scanPushedCommit(
        input.db,
        repository,
        event,
        emptyDefaultBranch,
        input.deps,
      );
      logPushScan({ requestId: input.requestId, repoId: repository.id, ...outcome });
      await input.db.finishGitHubDelivery(
        deliveryId,
        true,
        outcome.status === 'too_large' ? 'Snapshot over the Full Gate size limit.' : undefined,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logPushScan({
        requestId: input.requestId,
        repoId: repository.id,
        status: 'failed',
        errorType: error instanceof Error ? error.name : 'UnknownError',
      });
      await input.db.finishGitHubDelivery(deliveryId, false, message).catch(() => undefined);
    }
  });
  return { status: 202, message: 'Push accepted.' };
}
