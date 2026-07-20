import { z } from 'zod';
import type { Organization, Repository, Scan, ScanFinding, User } from './dbAdapter';

const userSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
  avatar_url: z.string(),
});
const organizationSchema = z.object({
  id: z.string(),
  name: z.string(),
  billing_plan: z.enum(['free', 'pro', 'oem']),
  stripe_customer_id: z.string().optional(),
  github_org_id: z.number().optional(),
  github_installation_id: z.string().optional(),
  created_at: z.string(),
});
const repositorySchema = z.object({
  id: z.string(),
  organization_id: z.string(),
  name: z.string(),
  github_repo_id: z.number(),
  is_active: z.boolean(),
  created_at: z.string(),
});
const scanSchema = z.object({
  id: z.string(),
  repository_id: z.string(),
  commit_sha: z.string(),
  branch: z.string(),
  status: z.enum(['success', 'failed']),
  error_count: z.number(),
  warning_count: z.number(),
  share_token: z.string().nullable().optional(),
  created_at: z.string(),
});
// Persisted rows return an explicit `null` for unset optional columns (Postgres/
// PostgREST, not "absent key"), so these accept null in addition to undefined —
// then normalise to undefined so the inferred TS type matches ScanFinding.
const nullToUndefined = <T extends z.ZodTypeAny>(schema: T) =>
  schema
    .nullable()
    .optional()
    .transform((value) => value ?? undefined);

const findingSchema = z.object({
  id: z.string(),
  scan_id: z.string(),
  rule_id: z.string(),
  severity: z.enum(['error', 'warning']),
  confidence: nullToUndefined(z.enum(['high', 'medium', 'low'])),
  file_path: z.string(),
  line_number: nullToUndefined(z.number()),
  message: z.string(),
  suggestion: nullToUndefined(z.string()),
  fix_pr_url: z.string().url().nullable().optional(),
  created_at: z.string(),
});
const reprobeSchema = z.object({
  probed: z.boolean(),
  outcomes: z.array(
    z.object({
      ruleId: z.string(),
      outcome: z.enum(['verified_fixed', 'still_open', 'regressed']),
    }),
  ),
});
export type ReprobeResult = z.infer<typeof reprobeSchema>;

const sessionSchema = z.object({
  user: userSchema.nullable(),
  organization: organizationSchema.nullable(),
  repositories: z.array(repositorySchema),
});
const scansSchema = z.object({ scans: z.array(scanSchema) });
const findingsSchema = z.object({ findings: z.array(findingSchema) });
const urlSchema = z.object({ url: z.string().url() });
const fixSchema = z.object({
  prUrl: z.string().url().optional(),
  findingIds: z.array(z.string().uuid()).optional(),
});
const shareReportSchema = z.object({
  token: z.string(),
  url: z.string().url(),
});
const trendPointSchema = z.object({
  date: z.string(),
  shipScore: z.number(),
});
const trendSchema = z.object({
  points: z.array(trendPointSchema),
});
const scanFindingInputSchema = findingSchema.omit({ id: true, scan_id: true, created_at: true });
const saveScanBodySchema = z.object({
  repoId: z.string().uuid(),
  commitSha: z.string(),
  branch: z.string(),
  status: z.enum(['success', 'failed']),
  errors: z.number().int().nonnegative(),
  warnings: z.number().int().nonnegative(),
  findings: z.array(scanFindingInputSchema),
  // Optional metadata for the target's current-verdict projection (Phase 1).
  generatorFingerprint: z.enum(['lovable', 'v0', 'bolt', 'cursor', 'replit', 'unknown']).optional(),
  scannedFileCount: z.number().int().nonnegative().optional(),
});
const verdictTopIssueSchema = z.object({
  key: z.string(),
  label: z.string(),
  severity: z.enum(['error', 'warning']),
  sampleMessage: z.string(),
  affectedFileCount: z.number(),
  occurrenceCount: z.number(),
});
const targetCardSchema = z.object({
  id: z.string(),
  kind: z.enum(['repo', 'url']),
  identifier: z.string(),
  displayName: z.string(),
  repositoryId: z.string().nullable(),
  generatorFingerprint: z.string().nullable(),
  verdict: z.enum(['ready', 'review', 'blocked', 'unknown']),
  shipScore: z.number().nullable(),
  topIssue: verdictTopIssueSchema.nullable(),
  lastCheckedAt: z.string().nullable(),
  latestScanId: z.string().nullable(),
  ownershipVerified: z.boolean(),
  guardianEnabled: z.boolean().default(false),
  scoreDropped: z.boolean().default(false),
  badgeToken: z.string().nullable().default(null),
});
const targetsSchema = z.object({ targets: z.array(targetCardSchema) });
export type TargetCard = z.infer<typeof targetCardSchema>;

const apiKeySchema = z.object({
  id: z.string(),
  label: z.string(),
  keyPrefix: z.string(),
  plan: z.enum(['free', 'pro', 'oem']),
  lastUsedAt: z.string().nullable(),
  revokedAt: z.string().nullable(),
  createdAt: z.string(),
});
const apiKeysListSchema = z.object({ keys: z.array(apiKeySchema) });
const apiKeyCreatedSchema = z.object({ apiKey: z.string(), key: apiKeySchema });
const apiKeyRevokedSchema = z.object({ revoked: z.boolean() });
const apiKeyDeletedSchema = z.object({ deleted: z.boolean() });
export type ApiKeySummary = z.infer<typeof apiKeySchema>;

const githubRepositorySchema = z.object({
  id: z.number(),
  name: z.string(),
  full_name: z.string(),
  description: z.string().nullable().default(null),
  stargazers_count: z.number().default(0),
  language: z.string().nullable().default(null),
});
const githubRepositoriesSchema = z.array(githubRepositorySchema);
const apiErrorEnvelopeSchema = z.object({
  error: z.union([
    z.string().min(1),
    z.object({
      code: z.string().optional(),
      message: z.string().min(1),
      requestId: z.string().optional(),
    }),
  ]),
});

export type GitHubRepository = z.infer<typeof githubRepositorySchema>;

export interface SessionResult {
  user: User | null;
  organization: Organization | null;
  repositories: Repository[];
}

export class ClientApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
    readonly requestId?: string,
  ) {
    super(message);
    this.name = 'ClientApiError';
  }
}

async function requestJson<TSchema extends z.ZodType>(
  input: string,
  schema: TSchema,
  init?: RequestInit,
): Promise<z.infer<TSchema>> {
  const response = await fetch(input, {
    credentials: 'same-origin',
    ...init,
    headers: { Accept: 'application/json', ...init?.headers },
  });
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const parsedError = apiErrorEnvelopeSchema.safeParse(payload);
    const error = parsedError.success ? parsedError.data.error : null;
    const message =
      typeof error === 'string' ? error : error?.message || 'The request could not be completed.';
    throw new ClientApiError(
      message,
      response.status,
      typeof error === 'string' ? undefined : error?.code,
      (typeof error === 'string' ? undefined : error?.requestId) ||
        response.headers.get('x-request-id') ||
        undefined,
    );
  }
  return schema.parse(payload);
}

function jsonRequest(method: 'POST' | 'PATCH' | 'DELETE', body?: unknown): RequestInit {
  return {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  };
}

export const clientApi = {
  session: (): Promise<SessionResult> => requestJson('/api/auth/session', sessionSchema),
  createRepository: (name: string, githubRepoId: number): Promise<Repository> =>
    requestJson('/api/repositories', repositorySchema, jsonRequest('POST', { name, githubRepoId })),
  scans: (repositoryId: string): Promise<{ scans: Scan[] }> =>
    requestJson(`/api/scans?repoId=${encodeURIComponent(repositoryId)}`, scansSchema),
  targets: (): Promise<{ targets: TargetCard[] }> => requestJson('/api/targets', targetsSchema),
  findings: (scanId: string): Promise<{ findings: ScanFinding[] }> =>
    requestJson(`/api/scans?scanId=${encodeURIComponent(scanId)}`, findingsSchema),
  saveScan: (body: z.input<typeof saveScanBodySchema>): Promise<Scan> =>
    requestJson('/api/scans', scanSchema, jsonRequest('POST', saveScanBodySchema.parse(body))),
  deleteScan: async (scanId: string): Promise<void> => {
    await requestJson(
      `/api/scans?scanId=${encodeURIComponent(scanId)}`,
      z.object({ ok: z.boolean() }),
      jsonRequest('DELETE'),
    );
  },
  checkout: (plan: 'monthly' | 'yearly'): Promise<{ url: string }> =>
    requestJson('/api/stripe/checkout', urlSchema, jsonRequest('POST', { plan })),
  portal: (): Promise<{ url: string }> =>
    requestJson('/api/stripe/portal', urlSchema, jsonRequest('POST')),
  createFix: (body: {
    repoId: string;
    scanId: string;
    findingId?: string;
    batch?: true;
  }): Promise<{ prUrl?: string; findingIds?: string[] }> =>
    requestJson('/api/github/fix', fixSchema, jsonRequest('POST', body)),
  shareScan: (scanId: string): Promise<{ token: string; url: string }> =>
    requestJson('/api/scans/share', shareReportSchema, jsonRequest('POST', { scanId })),
  trend: (repositoryId: string): Promise<{ points: Array<{ date: string; shipScore: number }> }> =>
    requestJson(`/api/repositories/${encodeURIComponent(repositoryId)}/trend`, trendSchema),
  contact: (body: {
    name: string;
    email: string;
    subject: string;
    message: string;
  }): Promise<{ success: boolean }> =>
    requestJson('/api/contact', z.object({ success: z.boolean() }), jsonRequest('POST', body)),
  reprobe: (targetId: string): Promise<ReprobeResult> =>
    requestJson(
      `/api/targets/${encodeURIComponent(targetId)}/reprobe`,
      reprobeSchema,
      jsonRequest('POST'),
    ),
  apiKeys: {
    list: (): Promise<{ keys: ApiKeySummary[] }> => requestJson('/api/api-keys', apiKeysListSchema),
    create: (label: string): Promise<{ apiKey: string; key: ApiKeySummary }> =>
      requestJson('/api/api-keys', apiKeyCreatedSchema, jsonRequest('POST', { label })),
    revoke: (id: string): Promise<{ revoked: boolean }> =>
      requestJson(
        `/api/api-keys/${encodeURIComponent(id)}/revoke`,
        apiKeyRevokedSchema,
        jsonRequest('POST'),
      ),
    delete: (id: string): Promise<{ deleted: boolean }> =>
      requestJson(
        `/api/api-keys/${encodeURIComponent(id)}`,
        apiKeyDeletedSchema,
        jsonRequest('DELETE'),
      ),
  },
};

export const githubApi = {
  repositories(owner: string): Promise<GitHubRepository[]> {
    const segment = encodeURIComponent(owner);
    return requestJson(
      `/api/github/discover?type=user-repos&owner=${segment}`,
      githubRepositoriesSchema,
    );
  },
  repository(fullName: string): Promise<GitHubRepository> {
    const [owner, repository, ...rest] = fullName.split('/');
    if (!owner || !repository || rest.length > 0) {
      throw new ClientApiError('Repository must use the owner/name format.', 400);
    }
    return requestJson(
      `/api/github/discover?type=repository&repo=${encodeURIComponent(`${owner}/${repository}`)}`,
      githubRepositorySchema,
    );
  },
};
