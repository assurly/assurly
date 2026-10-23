import { NextResponse } from 'next/server';
import { z } from 'zod';
import {
  ApiError,
  emptyObjectSchema,
  RATE_LIMITS,
  requireRouteUser,
  secureRoute,
} from '../../../../../../utils/apiSecurity';
import { requireOrganizationMember } from '../../../../../../utils/authorization';
import { enableLiveLock } from '../../../../../../utils/enableLiveLock';
import { getAdminDbAdapter } from '../../../../../../utils/dbAdapter';
import { putActionsSecret } from '../../../../../../utils/githubActionsSecret';
import {
  AutoFixAlreadyAppliedError,
  GitHubApiError,
  GitHubWriteAccessError,
  getGitHubAppSlug,
  getInstallationAccessToken,
} from '../../../../../../utils/githubApp';
import { executeGitHubFixPullRequest } from '../../../../../../utils/githubFixPipeline';
import { liveLockWorkflowFix } from '../../../../../../utils/githubAutoFix';
import { generateApiKey } from '../../../../../../utils/apiKeys';
import { entitlementsForPlan } from '../../../../../../utils/entitlements';
import { decryptVercelToken, vercelConnectConfigured } from '../../../../../../utils/vercelToken';
import { createVercelApi } from '../../../../../../utils/vercelApi';

const targetParams = z.object({ id: z.string().uuid() }).strict();

/**
 * Turns Live Lock on for a guarded URL the caller owns. The minted API key is
 * sealed into a GitHub Actions secret and is not returned.
 */
export const POST = secureRoute(
  {
    routeId: 'targets:live-lock:enable',
    auth: 'required',
    csrf: true,
    query: emptyObjectSchema,
    params: targetParams,
    body: z.undefined(),
    bodyMode: 'none',
    maxBodyBytes: 0,
    rateLimit: RATE_LIMITS.sensitive,
  },
  async ({ auth, params }) => {
    const context = requireRouteUser(auth);
    const organization = await context.db.getOrganizationByUserId(context.user.id);
    if (!organization) throw new ApiError(404, 'not_found', 'Target not found.');
    await requireOrganizationMember(context, organization.id);

    const target = await context.db.getTargetById(params.id);
    if (!target || target.organization_id !== organization.id) {
      throw new ApiError(404, 'not_found', 'Target not found.');
    }

    const admin = getAdminDbAdapter();
    const repositories = await context.db.getRepositories(organization.id);
    const connection = await admin.getVercelConnection(organization.id).catch(() => null);
    const token = connection ? safeDecrypt(connection.token_ciphertext) : null;
    const vercel = token === null ? null : createVercelApi(token, connection?.team_id ?? null);

    let installationToken: string | null = null;
    const result = await enableLiveLock(target, {
      repositories,
      installationId: organization.github_installation_id ?? null,
      installUrl: installUrl(),
      vercelConfigured: vercelConnectConfigured(),
      vercel,
      createKey: async () => {
        const generated = generateApiKey();
        const row = await admin.createApiKey({
          organizationId: organization.id,
          label: 'Live Lock',
          keyHash: generated.keyHash,
          keyPrefix: generated.keyPrefix,
          plan: entitlementsForPlan(organization.billing_plan).apiKeyTier,
        });
        return {
          plaintext: generated.plaintext,
          revoke: async () => {
            await admin.revokeApiKey(row.id);
          },
        };
      },
      writeSecret: async (name, value) => {
        try {
          const access =
            installationToken ??
            (await getInstallationAccessToken(organization.github_installation_id ?? ''));
          installationToken = access;
          return putActionsSecret({
            token: access,
            repositoryName: repositoryNameFor(repositories, target.identifier),
            name,
            value,
          });
        } catch (error) {
          if (
            error instanceof GitHubApiError &&
            (error.status === 401 || error.status === 403 || error.status === 404)
          ) {
            return 'permission_required';
          }
          throw error;
        }
      },
      openWorkflow: async () => {
        const repo = repositories.find(
          (item) => item.homepage_url === new URL(target.identifier).origin && item.is_active,
        );
        if (!repo) return { url: null, blocked: false };
        try {
          const url = await executeGitHubFixPullRequest({
            repositoryName: repo.name,
            baseBranch: repo.default_branch || 'main',
            filePath: '.github/workflows/assurly.yml',
            fix: liveLockWorkflowFix(),
            branchSeed: `live-lock:${target.id}`,
            userGitHubToken: context.githubAccessToken,
            installationId: organization.github_installation_id,
            repositoryId: repo.github_repo_id,
          });
          return { url, blocked: false };
        } catch (error) {
          if (error instanceof AutoFixAlreadyAppliedError) return { url: null, blocked: false };
          if (error instanceof GitHubWriteAccessError) return { url: null, blocked: true };
          throw error;
        }
      },
      saveProject: async (input) => {
        await admin.upsertLiveLockProject({
          organizationId: organization.id,
          targetId: target.id,
          repositoryId: input.repositoryId,
          vercelProjectId: input.vercelProjectId,
          vercelProjectName: input.vercelProjectName,
          productionDeployHeld: input.productionDeployHeld,
          pullRequestUrl: input.pullRequestUrl,
          secretsWritten: input.secretsWritten,
        });
      },
    });

    return NextResponse.json(result);
  },
);

function installUrl(): string {
  try {
    return `https://github.com/apps/${encodeURIComponent(getGitHubAppSlug())}/installations/new`;
  } catch {
    return 'https://github.com/apps';
  }
}

function repositoryNameFor(
  repositories: readonly { homepage_url?: string | null; name: string; is_active: boolean }[],
  identifier: string,
): string {
  let origin = identifier;
  try {
    origin = new URL(identifier).origin;
  } catch {
    origin = identifier;
  }
  return repositories.find((item) => item.homepage_url === origin && item.is_active)?.name ?? '';
}

function safeDecrypt(ciphertext: string): string | null {
  try {
    return decryptVercelToken(ciphertext);
  } catch {
    return null;
  }
}
