import type { Repository, Target } from './dbAdapter';
import type { ActionsSecretWrite } from './githubActionsSecret';
import { LIVE_LOCK_API_KEY_SECRET, LIVE_LOCK_TARGET_URL_SECRET } from './githubActionsSecret';
import { normalizeHomepageOrigin } from './repoHomepage';
import {
  ignoredBuildStepUpdate,
  PRODUCTION_IGNORE_BUILD_STEP,
  projectForOrigin,
  type VercelProjectSummary,
} from './vercelLiveLock';

export type EnableLiveLockStatus =
  | 'ownership_required'
  | 'repo_required'
  | 'github_permission_required'
  | 'vercel_not_configured'
  | 'vercel_required'
  | 'vercel_project_required'
  | 'ignored_build_conflict'
  | 'workflow_blocked'
  | 'locked';

export interface EnableLiveLockResult {
  status: EnableLiveLockStatus;
  installUrl: string | null;
  connectPath: string | null;
  pullRequestUrl: string | null;
}

export interface EnableLiveLockDeps {
  repositories: readonly Repository[];
  installationId: string | null;
  installUrl: string;
  vercelConfigured: boolean;
  vercel: {
    listProjects: () => Promise<readonly VercelProjectSummary[]>;
    setIgnoredBuildStep: (projectId: string, command: string) => Promise<void>;
  } | null;
  createKey: () => Promise<{ plaintext: string; revoke: () => Promise<void> }>;
  writeSecret: (name: string, value: string) => Promise<ActionsSecretWrite>;
  openWorkflow: () => Promise<{ url: string | null; blocked: boolean }>;
  saveProject: (input: {
    repositoryId: string;
    vercelProjectId: string | null;
    vercelProjectName: string | null;
    productionDeployHeld: boolean;
    pullRequestUrl: string | null;
    secretsWritten: boolean;
  }) => Promise<void>;
}

/**
 * Turns Live Lock on for one verified URL. The API key plaintext is used only
 * to seal the GitHub secret and is not part of the result.
 */
export async function enableLiveLock(
  target: Target,
  deps: EnableLiveLockDeps,
): Promise<EnableLiveLockResult> {
  if (target.kind !== 'url' || !target.ownership_verified) {
    return empty('ownership_required');
  }
  const origin = normalizeHomepageOrigin(target.identifier);
  if (!origin) return empty('repo_required');
  const repo = deps.repositories.find((item) => item.homepage_url === origin && item.is_active);
  if (!repo) return empty('repo_required');
  if (!deps.installationId) {
    return { ...empty('github_permission_required'), installUrl: deps.installUrl };
  }

  const key = await deps.createKey();
  let secretsWritten = false;
  try {
    const keyWrite = await deps.writeSecret(LIVE_LOCK_API_KEY_SECRET, key.plaintext);
    const urlWrite = await deps.writeSecret(LIVE_LOCK_TARGET_URL_SECRET, origin);
    if (keyWrite === 'permission_required' || urlWrite === 'permission_required') {
      await key.revoke();
      return { ...empty('github_permission_required'), installUrl: deps.installUrl };
    }
    secretsWritten = true;
  } catch (error) {
    await key.revoke();
    throw error;
  }

  const workflow = await deps.openWorkflow();
  const pullRequestUrl = workflow.url;
  if (workflow.blocked) {
    await deps.saveProject({
      repositoryId: repo.id,
      vercelProjectId: null,
      vercelProjectName: null,
      productionDeployHeld: false,
      pullRequestUrl,
      secretsWritten,
    });
    return { ...empty('workflow_blocked'), pullRequestUrl };
  }

  if (!deps.vercelConfigured) {
    await savePartial(deps, repo.id, pullRequestUrl, secretsWritten);
    return { ...empty('vercel_not_configured'), pullRequestUrl };
  }
  if (!deps.vercel) {
    await savePartial(deps, repo.id, pullRequestUrl, secretsWritten);
    return { ...empty('vercel_required'), connectPath: '/api/vercel/connect', pullRequestUrl };
  }

  const project = projectForOrigin(await deps.vercel.listProjects(), origin);
  if (!project) {
    await savePartial(deps, repo.id, pullRequestUrl, secretsWritten);
    return { ...empty('vercel_project_required'), pullRequestUrl };
  }
  const step = ignoredBuildStepUpdate(project.ignoredBuildStep);
  if (step === 'conflict') {
    await deps.saveProject({
      repositoryId: repo.id,
      vercelProjectId: project.id,
      vercelProjectName: project.name,
      productionDeployHeld: false,
      pullRequestUrl,
      secretsWritten,
    });
    return { ...empty('ignored_build_conflict'), pullRequestUrl };
  }
  if (step === 'set') {
    await deps.vercel.setIgnoredBuildStep(project.id, PRODUCTION_IGNORE_BUILD_STEP);
  }
  await deps.saveProject({
    repositoryId: repo.id,
    vercelProjectId: project.id,
    vercelProjectName: project.name,
    productionDeployHeld: true,
    pullRequestUrl,
    secretsWritten,
  });
  return { ...empty('locked'), pullRequestUrl };
}

function empty(status: EnableLiveLockStatus): EnableLiveLockResult {
  return { status, installUrl: null, connectPath: null, pullRequestUrl: null };
}

function savePartial(
  deps: EnableLiveLockDeps,
  repositoryId: string,
  pullRequestUrl: string | null,
  secretsWritten: boolean,
): Promise<void> {
  return deps.saveProject({
    repositoryId,
    vercelProjectId: null,
    vercelProjectName: null,
    productionDeployHeld: false,
    pullRequestUrl,
    secretsWritten,
  });
}
