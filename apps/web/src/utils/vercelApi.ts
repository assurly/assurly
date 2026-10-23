import { promoteRequest, type VercelProjectSummary } from './vercelLiveLock';

interface VercelAlias {
  domain?: unknown;
}

interface VercelProjectPayload {
  id?: unknown;
  name?: unknown;
  commandForIgnoringBuildStep?: unknown;
  alias?: unknown;
  targets?: unknown;
}

/**
 * Vercel REST calls for Live Lock. The token stays in the caller; this module
 * never logs it.
 */
export function createVercelApi(
  token: string,
  teamId: string | null,
  fetchImpl: typeof fetch = fetch,
): {
  listProjects: () => Promise<VercelProjectSummary[]>;
  setIgnoredBuildStep: (projectId: string, command: string) => Promise<void>;
  promote: (projectName: string, deploymentId: string) => Promise<void>;
} {
  const headers = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
  const team = teamId ? `teamId=${encodeURIComponent(teamId)}` : '';

  return {
    async listProjects(): Promise<VercelProjectSummary[]> {
      const response = await fetchImpl(`https://api.vercel.com/v9/projects?limit=100&${team}`, {
        headers,
      });
      if (!response.ok) {
        throw new Error(`Vercel project list failed (${response.status}).`);
      }
      const body = (await response.json()) as { projects?: unknown };
      if (!Array.isArray(body.projects)) return [];
      return body.projects.flatMap((item) => {
        const summary = summarizeProject(item);
        return summary ? [summary] : [];
      });
    },
    async setIgnoredBuildStep(projectId: string, command: string): Promise<void> {
      const response = await fetchImpl(
        `https://api.vercel.com/v9/projects/${encodeURIComponent(projectId)}?${team}`,
        {
          method: 'PATCH',
          headers,
          body: JSON.stringify({ commandForIgnoringBuildStep: command }),
        },
      );
      if (!response.ok) {
        throw new Error(`Vercel project update failed (${response.status}).`);
      }
    },
    async promote(projectName: string, deploymentId: string): Promise<void> {
      const request = promoteRequest(projectName, deploymentId);
      const response = await fetchImpl(`https://api.vercel.com${request.path}?${team}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(request.body),
      });
      if (!response.ok) {
        throw new Error(`Vercel promote failed (${response.status}).`);
      }
    },
  };
}

export function summarizeProject(value: unknown): VercelProjectSummary | null {
  if (!value || typeof value !== 'object') return null;
  const project = value as VercelProjectPayload;
  if (typeof project.id !== 'string' || typeof project.name !== 'string') return null;
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(project.id)) return null;
  return {
    id: project.id,
    name: project.name,
    origins: originsOf(project),
    ignoredBuildStep:
      typeof project.commandForIgnoringBuildStep === 'string'
        ? project.commandForIgnoringBuildStep
        : null,
  };
}

function originsOf(project: VercelProjectPayload): string[] {
  const origins = new Set<string>();
  const push = (candidate: unknown): void => {
    if (typeof candidate !== 'string' || !candidate.trim()) return;
    try {
      const url = new URL(candidate.includes('://') ? candidate : `https://${candidate}`);
      if (url.protocol === 'https:') origins.add(url.origin);
    } catch {
      // Ignore a host Vercel sent that is not a URL.
    }
  };
  if (Array.isArray(project.alias)) {
    for (const alias of project.alias) {
      if (alias && typeof alias === 'object') push((alias as VercelAlias).domain);
      else push(alias);
    }
  }
  const targets =
    project.targets && typeof project.targets === 'object'
      ? (project.targets as Record<string, unknown>)
      : {};
  const production =
    targets.production && typeof targets.production === 'object'
      ? (targets.production as Record<string, unknown>)
      : {};
  push(production.url);
  if (Array.isArray(production.alias)) {
    for (const alias of production.alias) push(alias);
  }
  return [...origins];
}
