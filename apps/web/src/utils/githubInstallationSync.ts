import { z } from 'zod';
import { ApiError } from './apiSecurity';
import type { DbAdapter, GitHubRepositoryMapping } from './dbAdapter';
import { getGitHubInstallation, getInstallationAccessToken, githubHeaders } from './githubApp';

const MAX_REPOSITORY_PAGES = 10;
const REPOSITORIES_PER_PAGE = 100;

const installationSchema = z
  .object({ account: z.object({ id: z.number().int().positive().safe() }) })
  .passthrough();

const repositoryPageSchema = z
  .object({
    repositories: z
      .array(
        z
          .object({
            id: z.number().int().positive().safe(),
            full_name: z
              .string()
              .regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/)
              .max(201),
          })
          .passthrough(),
      )
      .max(REPOSITORIES_PER_PAGE),
  })
  .passthrough();

/** Every repository the installation can reach, as GitHub reports it now. */
export async function listInstallationRepositories(
  token: string,
): Promise<GitHubRepositoryMapping[]> {
  const repositories: GitHubRepositoryMapping[] = [];
  for (let page = 1; page <= MAX_REPOSITORY_PAGES; page += 1) {
    const url = new URL('https://api.github.com/installation/repositories');
    url.searchParams.set('per_page', String(REPOSITORIES_PER_PAGE));
    url.searchParams.set('page', String(page));
    const response = await fetch(url, { headers: githubHeaders(token) });
    if (!response.ok) throw new ApiError(502, 'github_unavailable', 'GitHub is unavailable.');
    const data = repositoryPageSchema.parse(await response.json());
    repositories.push(
      ...data.repositories.map((repository) => ({
        id: repository.id,
        fullName: repository.full_name,
      })),
    );
    if (data.repositories.length < REPOSITORIES_PER_PAGE) return repositories;
  }
  throw new ApiError(422, 'repository_limit_exceeded', 'Installation has too many repositories.');
}

/** Maps the installation's current repositories onto an organization. */
export async function connectInstallationRepositories(
  db: Pick<DbAdapter, 'connectGitHubInstallation'>,
  organizationId: string,
  installationId: string,
): Promise<number> {
  const installation = installationSchema.parse(await getGitHubInstallation(installationId));
  const token = await getInstallationAccessToken(installationId);
  const repositories = await listInstallationRepositories(token);
  return db.connectGitHubInstallation(
    organizationId,
    installation.account.id,
    installationId,
    repositories,
  );
}

/**
 * Re-syncs the workspace already connected to this installation, after GitHub
 * reports that its repository access changed. Without it, a repository created
 * or granted later only appeared if GitHub happened to redirect the user back
 * through the install callback. Returns null when no workspace owns the
 * installation yet: the install callback connects it.
 */
export async function syncInstallationRepositories(
  db: Pick<DbAdapter, 'connectGitHubInstallation' | 'getOrganizationByGitHubInstallationId'>,
  installationId: string,
): Promise<number | null> {
  const organization = await db.getOrganizationByGitHubInstallationId(installationId);
  if (!organization) return null;
  return connectInstallationRepositories(db, organization.id, installationId);
}
