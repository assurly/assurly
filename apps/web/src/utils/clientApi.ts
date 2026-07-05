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
  billing_plan: z.enum(['free', 'pro']),
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
const findingSchema = z.object({
  id: z.string(),
  scan_id: z.string(),
  rule_id: z.string(),
  severity: z.enum(['error', 'warning']),
  confidence: z.enum(['high', 'medium', 'low']).optional(),
  file_path: z.string(),
  line_number: z.number().optional(),
  message: z.string(),
  suggestion: z.string().optional(),
  fix_pr_url: z.string().url().nullable().optional(),
  created_at: z.string(),
});
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
});
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
  findings: (scanId: string): Promise<{ findings: ScanFinding[] }> =>
    requestJson(`/api/scans?scanId=${encodeURIComponent(scanId)}`, findingsSchema),
  saveScan: (body: z.input<typeof saveScanBodySchema>): Promise<Scan> =>
    requestJson('/api/scans', scanSchema, jsonRequest('POST', saveScanBodySchema.parse(body))),
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
