import { NextResponse } from 'next/server';
import { z } from 'zod';
import {
  ApiError,
  assertTrustedRedirect,
  emptyObjectSchema,
  RATE_LIMITS,
  requireRouteUser,
  secureRoute,
} from '../../../../utils/apiSecurity';
import {
  AuthorizationError,
  requireFindingAccess,
  requireScanAccess,
} from '../../../../utils/authorization';
import { resolveGitHubAccessToken } from '../../../../utils/auth';
import {
  buildGitHubAutoFix,
  buildGitHubAutoFixPlan,
  isAutoFixableFinding,
  resolveFindingAutoFixTargetPath,
} from '../../../../utils/githubAutoFix';
import {
  executeGitHubBatchFixPullRequest,
  executeGitHubFixPullRequest,
} from '../../../../utils/githubFixPipeline';
import {
  AutoFixAlreadyAppliedError,
  GitHubApiError,
  GitHubWriteAccessError,
  isGitHubRepositoryName,
} from '../../../../utils/githubApp';

const WORKFLOW_DIRECTORY_PREFIX = '.github/workflows/';

function isWorkflowPath(filePath: string): boolean {
  return filePath.startsWith(WORKFLOW_DIRECTORY_PREFIX);
}

// GitHub answers 404 — not 403 — when a token may not write under
// .github/workflows/, so this is a permission problem, not a missing repository.
function workflowPermissionError(filePaths: string[]): ApiError {
  return new ApiError(
    403,
    'github_workflow_permission_required',
    `Assurly is not allowed to write ${filePaths.join(', ')}. GitHub requires an explicit "Workflows" permission for files under ${WORKFLOW_DIRECTORY_PREFIX}. Grant it to the Assurly GitHub App, or create the workflow yourself by running "npx assurly init".`,
  );
}

// The batch pipeline skips files it cannot commit rather than failing the whole
// pull request, so an empty commit list is a permission or state problem — never
// evidence that GitHub is down.
function nothingCommittedError(skippedFilePaths: string[]): ApiError {
  const workflowFiles = skippedFilePaths.filter(isWorkflowPath);
  if (workflowFiles.length > 0) return workflowPermissionError(workflowFiles);
  return new ApiError(
    502,
    'github_unavailable',
    'No fixes could be committed. GitHub may be temporarily unavailable.',
  );
}

// Auto-fix failures funnel through here. The security wrapper only logs
// error.name, so without logging the real cause the underlying GitHub failure
// is invisible in the server logs.
function rethrowAutoFixError(operation: string, error: unknown, targetFilePath?: string): never {
  if (error instanceof GitHubWriteAccessError) throw error;
  if (error instanceof AutoFixAlreadyAppliedError) {
    throw new ApiError(409, 'fix_already_applied', error.message);
  }
  console.error(`[github/fix] ${operation} failed:`, error);
  if (error instanceof GitHubApiError) {
    if (error.status === 404) {
      if (targetFilePath && isWorkflowPath(targetFilePath)) {
        throw workflowPermissionError([targetFilePath]);
      }
      throw new ApiError(
        404,
        'repository_unavailable',
        'This repository is not accessible to the Assurly GitHub App installation. Re-install the app or grant it access to this repository, then try again.',
      );
    }
    // A 422 here is a git state conflict, not an access problem — telling the
    // user to re-install the app (the generic GitHubApiError mapping) would be
    // wrong advice.
    if (error.status === 422) {
      throw new ApiError(
        409,
        'fix_pull_request_conflict',
        'GitHub rejected this fix. An open fix pull request may already exist, or the branch changed since this scan. Re-scan the repository and try again.',
      );
    }
    throw error;
  }
  throw new ApiError(502, 'github_unavailable', 'GitHub is temporarily unavailable.');
}

const singleFixBody = z
  .object({
    repoId: z.string().uuid(),
    scanId: z.string().uuid(),
    findingId: z.string().uuid(),
  })
  .strict();

const batchFixBody = z
  .object({
    repoId: z.string().uuid(),
    scanId: z.string().uuid(),
    batch: z.literal(true),
  })
  .strict();

const fixBody = z.union([singleFixBody, batchFixBody]);

function githubConfigured(
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
    return Promise.resolve(true);
  }
  return resolveGitHubAccessToken(request).then(Boolean);
}

async function persistFixPullRequest(
  context: ReturnType<typeof requireRouteUser>,
  findingIds: string[],
  prUrl: string,
): Promise<void> {
  const trustedUrl = assertTrustedRedirect(prUrl, ['https://github.com']);
  await context.db.updateFindingFixPrUrls(
    findingIds.map((findingId) => ({ findingId, fixPrUrl: trustedUrl })),
  );
}

export const POST = secureRoute(
  {
    routeId: 'github:fix',
    auth: 'required',
    query: emptyObjectSchema,
    params: emptyObjectSchema,
    body: fixBody,
    bodyMode: 'json',
    maxBodyBytes: 4 * 1024,
    rateLimit: RATE_LIMITS.expensive,
    csrf: true,
  },
  async ({ auth, body, request }) => {
    const context = requireRouteUser(auth);

    if ('batch' in body) {
      const access = await requireScanAccess(context, body.scanId);
      if (access.repository.id !== body.repoId) {
        throw new AuthorizationError('Scan not found');
      }
      if (!(await githubConfigured(context, request, access.organization.github_installation_id))) {
        throw new ApiError(503, 'github_not_configured', 'GitHub integration is unavailable.');
      }
      if (!isGitHubRepositoryName(access.repository.name)) {
        throw new ApiError(
          422,
          'invalid_repository',
          'The connected repository name is invalid. Reconnect the repository and try again.',
        );
      }

      const scanFindings = await context.db.getScanFindings(body.scanId);
      const pendingFindings = scanFindings.filter(
        (finding) => isAutoFixableFinding(finding) && !finding.fix_pr_url,
      );
      if (pendingFindings.length === 0) {
        const alreadyLinked = scanFindings.find((finding) => finding.fix_pr_url);
        if (alreadyLinked?.fix_pr_url) {
          return NextResponse.json(
            {
              prUrl: assertTrustedRedirect(alreadyLinked.fix_pr_url, ['https://github.com']),
              findingIds: scanFindings
                .filter((finding) => finding.fix_pr_url === alreadyLinked.fix_pr_url)
                .map((finding) => finding.id),
            },
            { status: 201 },
          );
        }
        throw new ApiError(400, 'not_fixable', 'No auto-fixable findings remain for this scan.');
      }

      let plan;
      try {
        plan = buildGitHubAutoFixPlan(pendingFindings);
      } catch {
        throw new ApiError(400, 'unsafe_fix_input', 'Findings cannot be fixed safely.');
      }
      if (!plan) {
        throw new ApiError(
          400,
          'not_fixable',
          'Remaining findings cannot be combined into a single pull request.',
        );
      }

      const githubAccessToken =
        context.githubAccessToken ?? (await resolveGitHubAccessToken(request));

      let batchResult;
      try {
        batchResult = await executeGitHubBatchFixPullRequest({
          repositoryName: access.repository.name,
          baseBranch: access.scan.branch || 'main',
          files: plan,
          branchSeed: `batch:${body.scanId}`,
          userGitHubToken: githubAccessToken,
          installationId: access.organization.github_installation_id,
          repositoryId: access.repository.github_repo_id,
        });
      } catch (error) {
        rethrowAutoFixError('batch fix pull request', error);
      }

      // Only mark findings whose target file actually landed in the pull request.
      const committedPaths = new Set(batchResult.committedFilePaths);
      const findingIds = pendingFindings
        .filter((finding) => committedPaths.has(resolveFindingAutoFixTargetPath(finding)))
        .map((finding) => finding.id);

      if (findingIds.length === 0) {
        throw nothingCommittedError(batchResult.skippedFilePaths);
      }

      await persistFixPullRequest(context, findingIds, batchResult.prUrl);
      return NextResponse.json(
        {
          prUrl: assertTrustedRedirect(batchResult.prUrl, ['https://github.com']),
          findingIds,
        },
        { status: 201 },
      );
    }

    const access = await requireFindingAccess(context, body.findingId);
    if (access.scan.id !== body.scanId || access.repository.id !== body.repoId) {
      throw new AuthorizationError('Finding not found');
    }
    if (access.finding.fix_pr_url) {
      return NextResponse.json(
        {
          prUrl: assertTrustedRedirect(access.finding.fix_pr_url, ['https://github.com']),
          findingIds: [access.finding.id],
        },
        { status: 201 },
      );
    }

    let fix;
    try {
      fix = buildGitHubAutoFix(
        access.finding.file_path,
        access.finding.message,
        access.finding.rule_id,
      );
    } catch {
      throw new ApiError(400, 'unsafe_fix_input', 'Finding cannot be fixed safely.');
    }
    if (!fix) throw new ApiError(400, 'not_fixable', 'Finding is not auto-fixable.');
    if (!(await githubConfigured(context, request, access.organization.github_installation_id))) {
      throw new ApiError(503, 'github_not_configured', 'GitHub integration is unavailable.');
    }
    if (!isGitHubRepositoryName(access.repository.name)) {
      throw new ApiError(
        422,
        'invalid_repository',
        'The connected repository name is invalid. Reconnect the repository and try again.',
      );
    }

    const githubAccessToken =
      context.githubAccessToken ?? (await resolveGitHubAccessToken(request));

    let prUrl: string;
    try {
      prUrl = await executeGitHubFixPullRequest({
        repositoryName: access.repository.name,
        baseBranch: access.scan.branch || 'main',
        filePath: access.finding.file_path,
        fix,
        branchSeed: access.finding.id,
        userGitHubToken: githubAccessToken,
        installationId: access.organization.github_installation_id,
        repositoryId: access.repository.github_repo_id,
      });
    } catch (error) {
      rethrowAutoFixError(
        'single fix pull request',
        error,
        resolveFindingAutoFixTargetPath(access.finding),
      );
    }

    await persistFixPullRequest(context, [access.finding.id], prUrl);
    return NextResponse.json(
      {
        prUrl: assertTrustedRedirect(prUrl, ['https://github.com']),
        findingIds: [access.finding.id],
      },
      { status: 201 },
    );
  },
);
