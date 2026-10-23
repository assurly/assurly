/**
 * Skip automatic production builds (exit 0) and keep preview builds (exit 1).
 * Vercel treats exit 0 from `commandForIgnoringBuildStep` as "do not build".
 * Confirmed against the Update Project REST field `commandForIgnoringBuildStep`.
 */
export const PRODUCTION_IGNORE_BUILD_STEP =
  'if [ "$VERCEL_ENV" = "production" ]; then exit 0; else exit 1; fi';

export interface VercelProjectSummary {
  id: string;
  name: string;
  origins: readonly string[];
  ignoredBuildStep: string | null;
}

export function projectForOrigin(
  projects: readonly VercelProjectSummary[],
  origin: string,
): VercelProjectSummary | null {
  return projects.find((project) => project.origins.includes(origin)) ?? null;
}

/**
 * Writes the ignore step only when the project has none, or already has ours.
 * A custom command is left untouched.
 */
export function ignoredBuildStepUpdate(existing: string | null): 'already' | 'set' | 'conflict' {
  const current = existing?.trim() ?? '';
  if (!current) return 'set';
  if (current === PRODUCTION_IGNORE_BUILD_STEP) return 'already';
  return 'conflict';
}

export function promoteRequest(
  projectName: string,
  deploymentId: string,
): {
  path: string;
  body: { deploymentId: string; name: string; target: 'production'; meta: { action: 'promote' } };
} {
  return {
    path: '/v13/deployments',
    body: {
      deploymentId,
      name: projectName,
      target: 'production',
      meta: { action: 'promote' },
    },
  };
}
