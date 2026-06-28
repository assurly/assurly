import { after, NextResponse } from 'next/server';
import { z } from 'zod';
import {
  ApiError,
  emptyObjectSchema,
  RATE_LIMITS,
  secureRoute,
} from '../../../../utils/apiSecurity';
import { getAdminDbAdapter, type DbAdapter, type Repository } from '../../../../utils/dbAdapter';
import {
  fetchGitHubFile,
  getGitHubWebhookSecret,
  getInstallationAccessToken,
  githubHeaders,
  githubRepositoryApiUrl,
  readLimitedResponseText,
  verifyGitHubWebhookSignature,
} from '../../../../utils/githubApp';
import { buildShipGateReport, formatShipGateMarkdown } from '@shipready/scanner-core';
import {
  incompleteScanFinding,
  scanColdStart,
  scanEnvVariables,
  scanRscDataLeaks,
  scanSqlMigration,
  scanStripeWebhook,
  scanSupabaseClientLeaks,
  selectFiles,
  type WebFinding,
} from '../../../../utils/browserScanner';

export const maxDuration = 60;

const pullRequestWebhookSchema = z
  .object({
    action: z.string().min(1).max(80),
    installation: z.object({ id: z.number().int().positive().safe() }).passthrough(),
    repository: z
      .object({
        id: z.number().int().positive().safe(),
        full_name: z
          .string()
          .min(3)
          .max(201)
          .regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/),
      })
      .passthrough(),
    pull_request: z
      .object({
        head: z
          .object({
            sha: z.string().regex(/^[a-f0-9]{40,64}$/i),
            ref: z
              .string()
              .min(1)
              .max(255)
              .refine((value) => !value.includes('..') && !value.includes('\0')),
          })
          .passthrough(),
      })
      .passthrough(),
  })
  .passthrough();
type PullRequestWebhook = z.infer<typeof pullRequestWebhookSchema>;

const treeSchema = z
  .object({
    tree: z
      .array(
        z
          .object({
            path: z.string().min(1).max(1024),
            type: z.enum(['blob', 'tree', 'commit']),
          })
          .passthrough(),
      )
      .max(5000),
  })
  .passthrough();

async function githubJson<T>(
  url: string,
  token: string,
  schema: z.ZodType<T>,
  init: RequestInit = {},
): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      ...githubHeaders(token),
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...init.headers,
    },
  });
  if (!response.ok) {
    throw new ApiError(502, 'github_unavailable', 'GitHub is unavailable.');
  }
  return schema.parse(JSON.parse(await readLimitedResponseText(response, 512 * 1024)));
}

async function createCheckRun(
  token: string,
  repository: string,
  commitSha: string,
): Promise<number> {
  const data = await githubJson(
    githubRepositoryApiUrl(repository, 'check-runs'),
    token,
    z.object({ id: z.number().int().positive().safe() }).passthrough(),
    {
      method: 'POST',
      body: JSON.stringify({
        name: 'ShipReady Exit Readiness Scan',
        head_sha: commitSha,
        status: 'in_progress',
        started_at: new Date().toISOString(),
      }),
    },
  );
  return data.id;
}

async function completeCheckRun(
  token: string,
  repository: string,
  checkRunId: number,
  findings: Array<WebFinding & { path?: string }>,
  options: { scannedFileCount: number; repositoryName: string },
): Promise<void> {
  const affectedPaths = new Set(
    findings
      .map((finding) => finding.path || finding.file)
      .filter((path): path is string => Boolean(path)),
  );
  const shipGate = buildShipGateReport(
    findings.map((finding) => ({
      severity: finding.severity,
      message: finding.message,
      file: finding.path || finding.file,
      line: finding.line,
      ruleId: finding.ruleId,
    })),
    {
      scannedFileCount: options.scannedFileCount,
      cleanFileCount: Math.max(0, options.scannedFileCount - affectedPaths.size),
    },
  );
  const summary = formatShipGateMarkdown(shipGate, { repositoryName: options.repositoryName });
  const annotationNote =
    findings.length > 50
      ? `\n\nGitHub displays the first 50 of ${findings.length} annotations; the complete result is stored in ShipReady.`
      : '';

  await githubJson(
    githubRepositoryApiUrl(repository, 'check-runs', String(checkRunId)),
    token,
    z.object({}).passthrough(),
    {
      method: 'PATCH',
      body: JSON.stringify({
        conclusion: shipGate.status === 'blocked' ? 'failure' : 'success',
        status: 'completed',
        completed_at: new Date().toISOString(),
        output: {
          title: `Ship Gate · ${shipGate.headline}`,
          summary: `${summary}${annotationNote}`,
          annotations: findings.slice(0, 50).map((finding) => ({
            path: finding.path || finding.file || 'unknown',
            start_line: finding.line || 1,
            end_line: finding.line || 1,
            annotation_level: finding.severity === 'error' ? 'failure' : 'warning',
            message: finding.message,
            suggestion: finding.suggestion || '',
          })),
        },
      }),
    },
  );
}

export function getScannerFileLimit(value = process.env.SCANNER_MAX_FILES): number {
  const parsed = Number(value ?? 100);
  return Number.isSafeInteger(parsed) ? Math.min(1000, Math.max(1, parsed)) : 100;
}

async function scanPullRequest(
  db: DbAdapter,
  repository: Repository,
  payload: PullRequestWebhook,
): Promise<void> {
  const installationId = String(payload.installation.id);
  const repositoryName = payload.repository.full_name;
  const commitSha = payload.pull_request.head.sha;
  const branch = payload.pull_request.head.ref;
  const token = await getInstallationAccessToken(installationId, payload.repository.id);
  const checkRunId = await createCheckRun(token, repositoryName, commitSha);

  const treeUrl = new URL(githubRepositoryApiUrl(repositoryName, 'git', 'trees', commitSha));
  treeUrl.searchParams.set('recursive', '1');
  const tree = (await githubJson(treeUrl.toString(), token, treeSchema)).tree;

  const sqlFiles: string[] = [];
  const envFiles: string[] = [];
  const codeFiles: string[] = [];
  for (const node of tree) {
    if (node.type !== 'blob') continue;
    const lower = node.path.toLowerCase();
    if (lower.endsWith('.sql')) sqlFiles.push(node.path);
    else if (lower.endsWith('.env.example') || lower === '.env') envFiles.push(node.path);
    else if (/\.(js|ts|jsx|tsx)$/.test(lower) && !lower.includes('node_modules/')) {
      codeFiles.push(node.path);
    }
  }

  const findings: Array<WebFinding & { path?: string }> = [];
  const stripeFiles = codeFiles.filter((path) => /stripe|webhook/i.test(path));
  const candidates = [...new Set([...sqlFiles, ...stripeFiles, ...codeFiles])];
  const selection = selectFiles(candidates, getScannerFileLimit());
  const selected = new Set(selection.files);
  const incomplete = incompleteScanFinding(selection);
  if (incomplete) findings.push(incomplete);
  const fileCache = new Map<string, string>();
  const getFile = async (path: string): Promise<string> => {
    const cached = fileCache.get(path);
    if (cached !== undefined) return cached;
    const content = await fetchGitHubFile(token, repositoryName, path, commitSha, 512 * 1024);
    fileCache.set(path, content);
    return content;
  };
  for (const path of sqlFiles.filter((file) => selected.has(file))) {
    const result = scanSqlMigration(await getFile(path), path);
    findings.push(...result.findings.map((finding) => ({ ...finding, path })));
  }
  for (const path of stripeFiles.filter((file) => selected.has(file))) {
    const result = scanStripeWebhook(await getFile(path), path);
    findings.push(...result.findings.map((finding) => ({ ...finding, path })));
  }

  const envExample = envFiles.find((path) => path.toLowerCase().endsWith('.env.example'));
  if (envExample) {
    const envContent = await getFile(envExample);
    const codeContent = (
      await Promise.all(codeFiles.filter((file) => selected.has(file)).map((path) => getFile(path)))
    ).join('\n');
    const result = scanEnvVariables(envContent, codeContent, envExample, 'code');
    findings.push(...result.findings.map((finding) => ({ ...finding, path: envExample })));
  }

  for (const path of codeFiles.filter((file) => selected.has(file))) {
    const content = await getFile(path);
    const rscResult = scanRscDataLeaks(content, path);
    findings.push(...rscResult.findings.map((finding) => ({ ...finding, path })));
    const supabaseResult = scanSupabaseClientLeaks(content, path);
    findings.push(...supabaseResult.findings.map((finding) => ({ ...finding, path })));
    if (path.includes('/api/')) {
      const coldStartResult = scanColdStart(content, path);
      findings.push(...coldStartResult.findings.map((finding) => ({ ...finding, path })));
    }
  }

  const errors = findings.filter((finding) => finding.severity === 'error').length;
  const warnings = findings.filter((finding) => finding.severity === 'warning').length;
  await db.saveScan(
    repository.id,
    commitSha,
    branch,
    errors > 0 ? 'failed' : 'success',
    errors,
    warnings,
    findings.map((finding) => ({
      rule_id: finding.ruleId,
      severity: finding.severity,
      file_path: finding.path || finding.file || 'unknown',
      line_number: finding.line || 1,
      message: finding.message,
      suggestion: finding.suggestion || '',
    })),
  );
  await completeCheckRun(token, repositoryName, checkRunId, findings, {
    scannedFileCount: selection.files.length,
    repositoryName,
  });
}

/** Receives authenticated GitHub App pull-request webhooks. */
export const POST = secureRoute(
  {
    routeId: 'github:webhook',
    auth: 'none',
    query: emptyObjectSchema,
    params: emptyObjectSchema,
    body: z.string().max(1024 * 1024),
    bodyMode: 'raw',
    maxBodyBytes: 1024 * 1024,
    rateLimit: RATE_LIMITS.webhook,
  },
  async ({ request, body, requestId }) => {
    const secret = getGitHubWebhookSecret();
    if (!verifyGitHubWebhookSignature(body, request.headers.get('x-hub-signature-256'), secret)) {
      throw new ApiError(401, 'invalid_signature', 'Invalid webhook signature.');
    }

    let rawPayload: unknown;
    try {
      rawPayload = JSON.parse(body);
    } catch {
      throw new ApiError(400, 'invalid_json', 'Request body must be valid JSON.');
    }
    if (request.headers.get('x-github-event') !== 'pull_request') {
      return NextResponse.json({ message: 'Event ignored.' });
    }

    const payload = pullRequestWebhookSchema.parse(rawPayload);
    if (!['opened', 'synchronize'].includes(payload.action)) {
      return NextResponse.json({ message: 'Action ignored.' });
    }

    const deliveryId = request.headers.get('x-github-delivery');
    if (!deliveryId || !/^[A-Za-z0-9-]{1,100}$/.test(deliveryId)) {
      throw new ApiError(400, 'invalid_delivery', 'Invalid delivery ID.');
    }

    const db = getAdminDbAdapter();
    const claimed = await db.claimGitHubDelivery(
      deliveryId,
      'pull_request',
      payload.repository.id,
      String(payload.installation.id),
    );
    if (!claimed) return NextResponse.json({ message: 'Duplicate delivery ignored.' });

    const repository = await db.getRepositoryByGithubRepoId(payload.repository.id);
    if (!repository) {
      await db.finishGitHubDelivery(deliveryId, false, 'Mapped repository not found.');
      throw new ApiError(404, 'not_found', 'Repository not found.');
    }

    after(async () => {
      try {
        await scanPullRequest(db, repository, payload);
        await db.finishGitHubDelivery(deliveryId, true);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(
          JSON.stringify({
            service: 'shipready-api',
            requestId,
            route: 'github:webhook:background',
            status: 'failed',
            errorType: error instanceof Error ? error.name : 'UnknownError',
          }),
        );
        await db.finishGitHubDelivery(deliveryId, false, message).catch((finishError) => {
          console.error(
            JSON.stringify({
              service: 'shipready-api',
              requestId,
              route: 'github:webhook:finalize',
              status: 'failed',
              errorType: finishError instanceof Error ? finishError.name : 'UnknownError',
            }),
          );
        });
      }
    });

    return NextResponse.json({ message: 'Webhook accepted.' }, { status: 202 });
  },
);
