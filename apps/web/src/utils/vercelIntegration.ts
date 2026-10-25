import { ConfigurationError, getApplicationUrl } from './env';

/**
 * The Vercel integration behind Live Lock. An integration installation token
 * can register blocking checks on a deployment; a Sign in with Vercel token
 * cannot call the REST API at all while API permissions are in private beta.
 *
 * Endpoints confirmed against Vercel's docs:
 * - install: https://vercel.com/integrations/:slug/new (external flow, `state` passed back)
 * - code exchange: POST /v2/oauth/access_token, returns `team_id` and `installation_id`
 * - checks: POST and PATCH /v1/deployments/{id}/checks, OAuth2 token only
 * - webhooks: HMAC-SHA1 of the raw body with the integration client secret
 */

const API = 'https://api.vercel.com';
const REQUEST_TIMEOUT_MS = 10_000;
const SLUG = /^[a-z0-9-]{1,32}$/;
const TEAM_ID = /^[A-Za-z0-9_-]{1,64}$/;
const CONFIGURATION_ID = /^icfg_[A-Za-z0-9]{1,64}$/;
const PROJECT_ID = /^[A-Za-z0-9_-]{1,64}$/;

/** The name Vercel shows next to the deployment. */
export const LIVE_LOCK_CHECK_NAME = 'Assurly Live Lock';

export interface VercelIntegrationConfig {
  clientId: string;
  clientSecret: string;
  slug: string;
}

/** Null until the integration exists, so the dashboard can say so instead of failing. */
export function getVercelIntegrationConfig(): VercelIntegrationConfig | null {
  const clientId = process.env.VERCEL_INTEGRATION_CLIENT_ID?.trim();
  const clientSecret = process.env.VERCEL_INTEGRATION_CLIENT_SECRET?.trim();
  const slug = process.env.VERCEL_INTEGRATION_SLUG?.trim();
  if (!clientId || !clientSecret || !slug || !SLUG.test(slug)) return null;
  if (!process.env.VERCEL_TOKEN_KEY?.trim()) return null;
  return { clientId, clientSecret, slug };
}

/** The secret Vercel signs integration webhooks with. */
export function getVercelIntegrationSecret(): string {
  const value = process.env.VERCEL_INTEGRATION_CLIENT_SECRET?.trim();
  if (!value) {
    throw new ConfigurationError(
      'VERCEL_INTEGRATION_CLIENT_SECRET is required for the Vercel integration webhook.',
    );
  }
  return value;
}

export function vercelIntegrationRedirectUri(): string {
  return `${getApplicationUrl()}/api/vercel/integration/callback`;
}

export function vercelIntegrationInstallUrl(slug: string, state: string): string {
  const url = new URL(`https://vercel.com/integrations/${encodeURIComponent(slug)}/new`);
  url.searchParams.set('state', state);
  return url.toString();
}

export class VercelApiError extends Error {
  constructor(
    readonly status: number,
    readonly operation: string,
    /** Vercel's own error code and message. Never the request, never a token. */
    readonly detail: string | null = null,
  ) {
    super(`Vercel ${operation} failed (${status})${detail ? `: ${detail}` : ''}.`);
    this.name = 'VercelApiError';
  }
}

/** `{ error: { code, message } }` from a Vercel response, trimmed for a log line. */
async function vercelErrorDetail(response: Response): Promise<string | null> {
  try {
    const body = (await response.json()) as { error?: { code?: unknown; message?: unknown } };
    const code = typeof body.error?.code === 'string' ? body.error.code : '';
    const message = typeof body.error?.message === 'string' ? body.error.message : '';
    const text = [code, message].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
    return text ? text.slice(0, 300) : null;
  } catch {
    return null;
  }
}

export interface VercelInstallation {
  accessToken: string;
  teamId: string | null;
  configurationId: string;
}

/** Exchanges the 30-minute install code for the long-lived installation token. */
export async function exchangeIntegrationCode(
  code: string,
  config: VercelIntegrationConfig,
  fetchImpl: typeof fetch = fetch,
): Promise<VercelInstallation> {
  const response = await fetchImpl(`${API}/v2/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      code,
      redirect_uri: vercelIntegrationRedirectUri(),
    }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) throw new VercelApiError(response.status, 'code exchange');
  const body = (await response.json()) as {
    access_token?: unknown;
    team_id?: unknown;
    installation_id?: unknown;
  };
  if (typeof body.access_token !== 'string' || !body.access_token) {
    throw new VercelApiError(502, 'code exchange');
  }
  if (typeof body.installation_id !== 'string' || !CONFIGURATION_ID.test(body.installation_id)) {
    throw new VercelApiError(502, 'code exchange');
  }
  const teamId =
    typeof body.team_id === 'string' && TEAM_ID.test(body.team_id) ? body.team_id : null;
  return { accessToken: body.access_token, teamId, configurationId: body.installation_id };
}

export interface VercelProjectSummary {
  id: string;
  name: string;
}

export type CheckConclusion = 'succeeded' | 'failed' | 'neutral';

export interface VercelIntegrationApi {
  listProjects(): Promise<VercelProjectSummary[]>;
  /** Production domains of a project: no branch domains, no redirects. */
  productionHosts(projectId: string): Promise<string[]>;
  createCheck(
    deploymentId: string,
    input: { blocking: boolean; detailsUrl: string },
  ): Promise<{ id: string }>;
  markCheckRunning(deploymentId: string, checkId: string): Promise<void>;
  completeCheck(
    deploymentId: string,
    checkId: string,
    input: { conclusion: CheckConclusion; detailsUrl: string },
  ): Promise<void>;
  /**
   * Mints a Deployment Protection bypass owned by this installation and
   * returns its secret. Vercel generates the value; we never choose it.
   */
  createProtectionBypass(projectId: string, configurationId: string): Promise<string>;
  revokeProtectionBypass(projectId: string, secret: string): Promise<void>;
}

const BYPASS_SECRET = /^[A-Za-z0-9]{32}$/;
const BYPASS_NOTE = 'Assurly Live Lock: checks production deploys before release';

/**
 * Vercel answers with every bypass on the project, keyed by secret. Ours is the
 * newest one this installation created; a bypass a person made is never used.
 */
export function pickInstallationBypass(body: unknown, configurationId: string): string | null {
  const map = (body as { protectionBypass?: unknown })?.protectionBypass;
  if (!map || typeof map !== 'object') return null;
  let picked: { secret: string; createdAt: number } | null = null;
  for (const [secret, meta] of Object.entries(map as Record<string, unknown>)) {
    if (!BYPASS_SECRET.test(secret) || !meta || typeof meta !== 'object') continue;
    const entry = meta as { configurationId?: unknown; createdAt?: unknown };
    if (entry.configurationId !== configurationId) continue;
    const createdAt = typeof entry.createdAt === 'number' ? entry.createdAt : 0;
    if (!picked || createdAt > picked.createdAt) picked = { secret, createdAt };
  }
  return picked?.secret ?? null;
}

/** REST calls made with one installation's token. The token is never logged. */
export function createVercelIntegrationApi(
  token: string,
  teamId: string | null,
  fetchImpl: typeof fetch = fetch,
): VercelIntegrationApi {
  const scope = teamId ? `teamId=${encodeURIComponent(teamId)}` : '';
  const call = async (operation: string, path: string, init: RequestInit = {}) => {
    const separator = path.includes('?') ? '&' : '?';
    const response = await fetchImpl(`${API}${path}${scope ? separator + scope : ''}`, {
      ...init,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) {
      throw new VercelApiError(response.status, operation, await vercelErrorDetail(response));
    }
    return response;
  };

  return {
    async listProjects() {
      const response = await call('project list', '/v9/projects?limit=100');
      const body = (await response.json()) as { projects?: unknown };
      if (!Array.isArray(body.projects)) return [];
      return body.projects.flatMap((item): VercelProjectSummary[] => {
        if (!item || typeof item !== 'object') return [];
        const { id, name } = item as { id?: unknown; name?: unknown };
        if (typeof id !== 'string' || !PROJECT_ID.test(id) || typeof name !== 'string') return [];
        return [{ id, name: name.slice(0, 100) }];
      });
    },
    async productionHosts(projectId) {
      const response = await call(
        'project domains',
        `/v9/projects/${encodeURIComponent(projectId)}/domains?limit=100`,
      );
      const body = (await response.json()) as { domains?: unknown };
      if (!Array.isArray(body.domains)) return [];
      return body.domains.flatMap((item): string[] => {
        if (!item || typeof item !== 'object') return [];
        const domain = item as { name?: unknown; gitBranch?: unknown; redirect?: unknown };
        if (typeof domain.name !== 'string' || domain.gitBranch || domain.redirect) return [];
        return [domain.name.toLowerCase()];
      });
    },
    async createCheck(deploymentId, input) {
      const response = await call(
        'check create',
        `/v1/deployments/${encodeURIComponent(deploymentId)}/checks`,
        {
          method: 'POST',
          body: JSON.stringify({
            name: LIVE_LOCK_CHECK_NAME,
            blocking: input.blocking,
            // Vercel refuses a rerunnable check unless the integration subscribes to
            // deployment.check-rerequested, which the Integration Console does not offer.
            rerequestable: false,
            detailsUrl: input.detailsUrl,
          }),
        },
      );
      const body = (await response.json()) as { id?: unknown };
      if (typeof body.id !== 'string' || !/^[A-Za-z0-9_-]{1,120}$/.test(body.id)) {
        throw new VercelApiError(502, 'check create');
      }
      return { id: body.id };
    },
    async markCheckRunning(deploymentId, checkId) {
      await call(
        'check update',
        `/v1/deployments/${encodeURIComponent(deploymentId)}/checks/${encodeURIComponent(checkId)}`,
        { method: 'PATCH', body: JSON.stringify({ status: 'running' }) },
      );
    },
    async createProtectionBypass(projectId, configurationId) {
      const response = await call(
        'protection bypass create',
        `/v1/projects/${encodeURIComponent(projectId)}/protection-bypass`,
        { method: 'PATCH', body: JSON.stringify({ generate: { note: BYPASS_NOTE } }) },
      );
      const secret = pickInstallationBypass(await response.json(), configurationId);
      if (!secret) throw new VercelApiError(502, 'protection bypass create');
      return secret;
    },
    async revokeProtectionBypass(projectId, secret) {
      await call(
        'protection bypass revoke',
        `/v1/projects/${encodeURIComponent(projectId)}/protection-bypass`,
        { method: 'PATCH', body: JSON.stringify({ revoke: { secret, regenerate: false } }) },
      );
    },
    async completeCheck(deploymentId, checkId, input) {
      await call(
        'check update',
        `/v1/deployments/${encodeURIComponent(deploymentId)}/checks/${encodeURIComponent(checkId)}`,
        {
          method: 'PATCH',
          body: JSON.stringify({
            status: 'completed',
            conclusion: input.conclusion,
            detailsUrl: input.detailsUrl,
          }),
        },
      );
    },
  };
}
