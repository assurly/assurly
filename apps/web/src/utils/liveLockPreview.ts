const GIT_SHA = /^[0-9a-f]{7,64}$/i;
const PROJECT_ID = /^[A-Za-z0-9_-]{1,64}$/;

export interface PreviewDeploymentFacts {
  projectId: string | null;
  deploymentId: string;
  /** `production` when Vercel is already shipping this deployment. */
  target: string | null;
  previewUrl: string | null;
  gitSha: string | null;
}

export type PreviewLockDecision =
  | { action: 'ignore' }
  | { action: 'refuse' }
  | { action: 'probe'; previewUrl: string; gitSha: string; attemptId: string };

/**
 * Whether a Vercel preview may be read before production is created.
 * A different project id is ignored: no fetch, no row. A matching project
 * with a missing commit or a non-preview host is refused and must not promote.
 */
export function decidePreviewLock(input: {
  linkedProjectId: string;
  deployment: PreviewDeploymentFacts;
}): PreviewLockDecision {
  const { deployment } = input;
  if (deployment.target === 'production') return { action: 'ignore' };
  if (!deployment.projectId || deployment.projectId !== input.linkedProjectId) {
    return { action: 'ignore' };
  }
  if (!PROJECT_ID.test(input.linkedProjectId)) return { action: 'ignore' };
  const gitSha = deployment.gitSha?.toLowerCase() ?? '';
  if (
    !GIT_SHA.test(gitSha) ||
    !deployment.previewUrl ||
    !isVercelPreviewUrl(deployment.previewUrl)
  ) {
    return { action: 'refuse' };
  }
  return {
    action: 'probe',
    previewUrl: deployment.previewUrl,
    gitSha,
    attemptId: deployment.deploymentId,
  };
}

/** Deployment hosts Vercel assigns. Custom production domains are not previews. */
export function isVercelPreviewUrl(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:' || url.username || url.password) return false;
  const host = url.hostname.toLowerCase();
  if (host !== 'vercel.app' && !host.endsWith('.vercel.app')) return false;
  if (host.includes('..')) return false;
  return true;
}

export function readPreviewDeployment(payload: unknown): PreviewDeploymentFacts | null {
  if (!payload || typeof payload !== 'object') return null;
  const root = payload as Record<string, unknown>;
  const inner = (root.payload && typeof root.payload === 'object' ? root.payload : {}) as Record<
    string,
    unknown
  >;
  const deployment = (
    inner.deployment && typeof inner.deployment === 'object' ? inner.deployment : null
  ) as Record<string, unknown> | null;
  if (!deployment) return null;
  const id = typeof deployment.id === 'string' ? deployment.id : '';
  if (!/^[A-Za-z0-9_-]{1,120}$/.test(id)) return null;
  const project = (
    deployment.project && typeof deployment.project === 'object' ? deployment.project : {}
  ) as Record<string, unknown>;
  const projectId =
    typeof project.id === 'string'
      ? project.id
      : typeof deployment.projectId === 'string'
        ? deployment.projectId
        : null;
  const meta = (
    deployment.meta && typeof deployment.meta === 'object' ? deployment.meta : {}
  ) as Record<string, unknown>;
  const shaCandidate =
    typeof meta.githubCommitSha === 'string'
      ? meta.githubCommitSha
      : typeof meta.gitCommitSha === 'string'
        ? meta.gitCommitSha
        : null;
  const rawUrl = typeof deployment.url === 'string' ? deployment.url : null;
  const previewUrl = rawUrl ? (rawUrl.includes('://') ? rawUrl : `https://${rawUrl}`) : null;
  const target =
    typeof inner.target === 'string'
      ? inner.target
      : typeof deployment.target === 'string'
        ? deployment.target
        : null;
  return { projectId, deploymentId: id, target, previewUrl, gitSha: shaCandidate };
}
