import { NextResponse } from 'next/server';
import { z } from 'zod';
import { ASSURLY_CANARY_ENV_KEY } from '@assurly/scanner-core';
import {
  ApiError,
  RATE_LIMITS,
  assertTrustedRedirect,
  requireRouteUser,
  secureRoute,
} from '../../../../../../utils/apiSecurity';
import { requireOwnedCanaryTarget } from '../../../../../../utils/canaryAccess';
import { generateCanaryToken } from '../../../../../../utils/canaryTokens';
import {
  CANARY_PLANT_HINT,
  CANARY_SILENT_ALARM_LABEL,
  buildCanaryCallbackUrl,
  buildCanaryMcpDecoySnippet,
  buildCanaryPlantSnippet,
  resolveCanaryCallbackOrigin,
} from '../../../../../../utils/canaryPlant';
import { getApplicationUrl } from '../../../../../../utils/env';
import { resolveGitHubAccessToken } from '../../../../../../utils/auth';
import {
  AutoFixAlreadyAppliedError,
  GitHubApiError,
  GitHubWriteAccessError,
  isGitHubRepositoryName,
} from '../../../../../../utils/githubApp';
import { executeGitHubFixPullRequest } from '../../../../../../utils/githubFixPipeline';

const targetParams = z.object({ id: z.string().uuid() }).strict();
const plantBody = z.object({}).strict();

async function githubConfigured(
  context: ReturnType<typeof requireRouteUser>,
  request: Request,
  installationId?: string,
): Promise<boolean> {
  if (
    installationId ||
    process.env.GITHUB_PAT ||
    process.env.GITHUB_TOKEN ||
    context.githubAccessToken
  ) {
    return true;
  }
  return resolveGitHubAccessToken(request).then(Boolean);
}

/**
 * Issue a silent alarm (if needed) and open a pull request that appends
 * ASSURLY_CANARY_URL to `.env.example`. Not a finding auto-fix — never uses
 * createFix / /api/github/fix.
 */
export const POST = secureRoute(
  {
    routeId: 'targets:canary-plant',
    auth: 'required',
    query: z.object({}).strict(),
    params: targetParams,
    body: plantBody,
    bodyMode: 'json',
    maxBodyBytes: 2 * 1024,
    rateLimit: RATE_LIMITS.sensitive,
    csrf: true,
  },
  async ({ auth, params, request }) => {
    const context = requireRouteUser(auth);
    const target = await requireOwnedCanaryTarget(context.db, params.id);
    if (!target.repository_id) {
      throw new ApiError(
        422,
        'plant_requires_github',
        'Connect this app to GitHub to open a plant pull request. Copy the snippet instead.',
      );
    }

    const repository = await context.db.getRepository(target.repository_id);
    if (!repository || repository.organization_id !== target.organization_id) {
      throw new ApiError(404, 'not_found', 'Repository not found.');
    }
    if (!isGitHubRepositoryName(repository.name)) {
      throw new ApiError(
        422,
        'invalid_repository',
        'The connected repository name is invalid. Reconnect the repository and try again.',
      );
    }

    const organization = await context.db.getOrganization(target.organization_id);
    if (!(await githubConfigured(context, request, organization?.github_installation_id))) {
      throw new ApiError(503, 'github_not_configured', 'GitHub integration is unavailable.');
    }

    const generated = generateCanaryToken();
    const callbackUrl = buildCanaryCallbackUrl(
      resolveCanaryCallbackOrigin(getApplicationUrl()),
      generated.plaintext,
    );
    const snippet = buildCanaryPlantSnippet(callbackUrl);
    const mcpSnippet = buildCanaryMcpDecoySnippet(callbackUrl);

    const githubAccessToken =
      context.githubAccessToken ?? (await resolveGitHubAccessToken(request));

    let prUrl: string | null = null;
    let alreadyPlanted = false;
    try {
      prUrl = await executeGitHubFixPullRequest({
        repositoryName: repository.name,
        baseBranch: 'main',
        filePath: '.env.example',
        fix: {
          statement: `${ASSURLY_CANARY_ENV_KEY}=${callbackUrl}`,
          description: `${CANARY_PLANT_HINT}\n\n${snippet}`,
          title: 'Plant Assurly silent alarm',
          targetFilePath: '.env.example',
          applyMode: 'upsert-env',
        },
        branchSeed: `canary-plant:${target.id}`,
        userGitHubToken: githubAccessToken,
        installationId: organization?.github_installation_id,
        repositoryId: repository.github_repo_id,
      });
    } catch (error) {
      if (error instanceof AutoFixAlreadyAppliedError) {
        alreadyPlanted = true;
      } else if (error instanceof GitHubWriteAccessError) {
        throw error;
      } else if (error instanceof GitHubApiError) {
        throw error;
      } else {
        throw new ApiError(502, 'github_unavailable', 'GitHub is temporarily unavailable.');
      }
    }

    if (alreadyPlanted) {
      return NextResponse.json(
        {
          alreadyPlanted: true,
          prUrl: null,
          snippet: `${ASSURLY_CANARY_ENV_KEY} is already in .env.example.`,
          plantHint: CANARY_PLANT_HINT,
        },
        { status: 200 },
      );
    }

    const row = await context.db.createCanaryToken({
      organizationId: target.organization_id,
      targetId: target.id,
      tokenHash: generated.tokenHash,
      tokenPrefix: generated.tokenPrefix,
      label: CANARY_SILENT_ALARM_LABEL,
    });

    const trustedPrUrl = prUrl ? assertTrustedRedirect(prUrl, ['https://github.com']) : null;

    return NextResponse.json(
      {
        id: row.id,
        label: row.label,
        tokenPrefix: row.token_prefix,
        token: generated.plaintext,
        callbackUrl,
        snippet,
        mcpSnippet,
        plantHint: CANARY_PLANT_HINT,
        prUrl: trustedPrUrl,
        alreadyPlanted: false,
        createdAt: row.created_at,
      },
      { status: 201 },
    );
  },
);
