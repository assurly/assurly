import type { LiveLockProjectRow, Target, UpsertLiveLockProjectInput } from './dbAdapter';
import type { LiveLockMode } from './liveLockCheck';
import {
  VercelApiError,
  type VercelIntegrationApi,
  type VercelProjectSummary,
} from './vercelIntegration';

export type LiveLockSetupStatus =
  | 'ownership_required'
  | 'vercel_not_configured'
  | 'vercel_required'
  | 'vercel_project_required'
  | 'project_mismatch'
  | 'active';

export interface LiveLockSetupResult {
  status: LiveLockSetupStatus;
  /** Where to install or reinstall the integration. */
  installUrl: string | null;
  /** Shown when no project serves the URL, so the user can pick one. */
  projects: VercelProjectSummary[];
  projectName: string | null;
  mode: LiveLockMode | null;
}

const PROBE_BATCH = 10;

export function setupResult(
  status: LiveLockSetupStatus,
  extra: Partial<Omit<LiveLockSetupResult, 'status'>> = {},
): LiveLockSetupResult {
  return {
    status,
    installUrl: extra.installUrl ?? null,
    projects: extra.projects ?? [],
    projectName: extra.projectName ?? null,
    mode: extra.mode ?? null,
  };
}

function hostOf(target: Target): string | null {
  try {
    return new URL(target.identifier).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/** The first project, in list order, whose production domains include the host. */
async function projectServing(
  api: VercelIntegrationApi,
  projects: readonly VercelProjectSummary[],
  host: string,
): Promise<VercelProjectSummary | null> {
  for (let start = 0; start < projects.length; start += PROBE_BATCH) {
    const batch = projects.slice(start, start + PROBE_BATCH);
    const hosts = await Promise.all(batch.map((project) => api.productionHosts(project.id)));
    const index = hosts.findIndex((list) => list.includes(host));
    if (index >= 0) return batch[index] ?? null;
  }
  return null;
}

export interface LinkLiveLockInput {
  target: Target;
  api: VercelIntegrationApi;
  teamId: string | null;
  /** A project the user picked. It must still serve the verified domain. */
  chosenProjectId: string | null;
  existing: LiveLockProjectRow | null;
  installUrl: string | null;
  save: (input: UpsertLiveLockProjectInput) => Promise<LiveLockProjectRow>;
}

/**
 * Locks a verified URL to the Vercel project that serves it in production.
 *
 * That link is what lets Live Lock probe a deployment's generated URL without
 * taking a URL from anyone: a deployment of this project is a build of this
 * domain. A project that does not list the domain is never linked, even when
 * the user picks it. A new lock starts in monitor mode.
 */
export async function linkLiveLockProject(input: LinkLiveLockInput): Promise<LiveLockSetupResult> {
  const { target, api } = input;
  if (target.kind !== 'url' || !target.ownership_verified) {
    return setupResult('ownership_required');
  }
  const host = hostOf(target);
  if (!host) return setupResult('ownership_required');

  let projects: VercelProjectSummary[];
  let match: VercelProjectSummary | null;
  try {
    projects = await api.listProjects();
    if (input.chosenProjectId) {
      const chosen = projects.find((project) => project.id === input.chosenProjectId) ?? null;
      const serves = chosen ? (await api.productionHosts(chosen.id)).includes(host) : false;
      if (!chosen || !serves) return setupResult('project_mismatch', { projects });
      match = chosen;
    } else {
      match = await projectServing(api, projects, host);
    }
  } catch (error) {
    if (error instanceof VercelApiError && (error.status === 401 || error.status === 403)) {
      return setupResult('vercel_required', { installUrl: input.installUrl });
    }
    throw error;
  }
  if (!match) return setupResult('vercel_project_required', { projects });

  const mode = input.existing?.vercel_project_id === match.id ? input.existing.mode : 'monitor';
  const row = await input.save({
    organizationId: target.organization_id,
    targetId: target.id,
    vercelProjectId: match.id,
    vercelProjectName: match.name,
    vercelTeamId: input.teamId,
    mode,
  });
  return setupResult('active', { projectName: row.vercel_project_name, mode: row.mode });
}
