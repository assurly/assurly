import { isVercelDeploymentUrl } from './liveLockCheck';
import { LIVE_LOCK_CHECK_NAME, VercelApiError, vercelErrorDetail } from './vercelIntegration';

/**
 * REST calls a native Marketplace installation makes with its own token.
 * Confirmed against Vercel's Checks v2 reference and the example Marketplace
 * integration (`vercel/example-marketplace-integration`):
 * - POST /v2/projects/{id}/checks with `source.kind = 'integration'`
 * - PATCH/DELETE /v2/projects/{id}/checks/{checkId}
 * - PATCH /v2/deployments/{id}/check-runs/{checkRunId}
 * The token is never logged; errors carry only Vercel's code and message.
 */

const API = 'https://api.vercel.com';
const REQUEST_TIMEOUT_MS = 10_000;
const CHECK_ID = /^[A-Za-z0-9_-]{1,120}$/;
const PROJECT_ID = /^[A-Za-z0-9_-]{1,64}$/;
const GIT_SHA = /^[0-9a-f]{7,64}$/;

/** A full Assurly run takes up to two minutes; Vercel's default is five. */
const CHECK_TIMEOUT_S = 300;

export type CheckRunConclusion = 'succeeded' | 'failed' | 'neutral';

/** `deployment-alias` holds the production domains until the run concludes. */
export function checkBlocksFor(blocking: boolean): 'deployment-alias' | 'none' {
  return blocking ? 'deployment-alias' : 'none';
}

export interface MarketplaceDeployment {
  id: string;
  url: string;
  projectId: string;
  production: boolean;
  gitSha: string | null;
}

export interface VercelMarketplaceApi {
  createProjectCheck(
    projectId: string,
    input: { resourceId: string; blocking: boolean },
  ): Promise<{ id: string }>;
  setProjectCheckBlocking(projectId: string, checkId: string, blocking: boolean): Promise<void>;
  deleteProjectCheck(projectId: string, checkId: string): Promise<void>;
  updateCheckRun(
    deploymentId: string,
    checkRunId: string,
    input:
      | { status: 'running' }
      | {
          status: 'completed';
          conclusion: CheckRunConclusion;
          conclusionText: string;
          externalUrl: string;
        },
  ): Promise<void>;
  getDeployment(deploymentId: string): Promise<MarketplaceDeployment>;
  /** Display-only usage and running total (POST /v1/installations/{id}/billing). */
  submitBillingData(installationId: string, body: Record<string, unknown>): Promise<void>;
  /** Charges the customer through Vercel (POST /v1/installations/{id}/billing/invoices). */
  submitInvoice(
    installationId: string,
    body: Record<string, unknown>,
  ): Promise<{ invoiceId: string }>;
  /** The banner on the installation in the Vercel dashboard; null clears it. */
  setInstallationNotification(
    installationId: string,
    notification: InstallationNotification | null,
  ): Promise<void>;
}

export interface InstallationNotification {
  level: 'info' | 'warn' | 'error';
  title: string;
  message?: string;
  href?: string;
}

export function createVercelMarketplaceApi(
  token: string,
  fetchImpl: typeof fetch = fetch,
): VercelMarketplaceApi {
  const call = async (operation: string, path: string, init: RequestInit = {}) => {
    const response = await fetchImpl(`${API}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) {
      throw new VercelApiError(response.status, operation, await vercelErrorDetail(response));
    }
    return response;
  };
  const projectChecks = (projectId: string) =>
    `/v2/projects/${encodeURIComponent(projectId)}/checks`;

  return {
    async createProjectCheck(projectId, input) {
      const response = await call('project check create', projectChecks(projectId), {
        method: 'POST',
        body: JSON.stringify({
          name: LIVE_LOCK_CHECK_NAME,
          source: { kind: 'integration', externalResourceId: input.resourceId },
          requires: 'deployment-url',
          blocks: checkBlocksFor(input.blocking),
          targets: ['production'],
          isRerequestable: true,
          timeout: CHECK_TIMEOUT_S,
        }),
      });
      const body = (await response.json()) as { id?: unknown };
      if (typeof body.id !== 'string' || !CHECK_ID.test(body.id)) {
        throw new VercelApiError(502, 'project check create');
      }
      return { id: body.id };
    },
    async setProjectCheckBlocking(projectId, checkId, blocking) {
      await call(
        'project check update',
        `${projectChecks(projectId)}/${encodeURIComponent(checkId)}`,
        {
          method: 'PATCH',
          body: JSON.stringify({ blocks: checkBlocksFor(blocking) }),
        },
      );
    },
    async deleteProjectCheck(projectId, checkId) {
      try {
        await call(
          'project check delete',
          `${projectChecks(projectId)}/${encodeURIComponent(checkId)}`,
          { method: 'DELETE' },
        );
      } catch (error) {
        // Already gone (the user removed it in Vercel) is the outcome we wanted.
        if (error instanceof VercelApiError && (error.status === 404 || error.status === 410)) {
          return;
        }
        throw error;
      }
    },
    async updateCheckRun(deploymentId, checkRunId, input) {
      await call(
        'check run update',
        `/v2/deployments/${encodeURIComponent(deploymentId)}/check-runs/${encodeURIComponent(checkRunId)}`,
        { method: 'PATCH', body: JSON.stringify(input) },
      );
    },
    async getDeployment(deploymentId) {
      const response = await call(
        'deployment read',
        `/v13/deployments/${encodeURIComponent(deploymentId)}`,
      );
      const body = (await response.json()) as {
        id?: unknown;
        url?: unknown;
        projectId?: unknown;
        target?: unknown;
        meta?: { githubCommitSha?: unknown };
      };
      const host = typeof body.url === 'string' ? body.url.trim().toLowerCase() : '';
      const url = `https://${host}`;
      if (
        body.id !== deploymentId ||
        typeof body.projectId !== 'string' ||
        !PROJECT_ID.test(body.projectId) ||
        !isVercelDeploymentUrl(`${url}/`)
      ) {
        throw new VercelApiError(502, 'deployment read');
      }
      const sha = typeof body.meta?.githubCommitSha === 'string' ? body.meta.githubCommitSha : '';
      return {
        id: deploymentId,
        url,
        projectId: body.projectId,
        production: body.target === 'production',
        gitSha: GIT_SHA.test(sha.toLowerCase()) ? sha.toLowerCase() : null,
      };
    },
    async submitBillingData(installationId, body) {
      await call(
        'billing data submit',
        `/v1/installations/${encodeURIComponent(installationId)}/billing`,
        {
          method: 'POST',
          body: JSON.stringify(body),
        },
      );
    },
    async submitInvoice(installationId, body) {
      const response = await call(
        'invoice submit',
        `/v1/installations/${encodeURIComponent(installationId)}/billing/invoices`,
        { method: 'POST', body: JSON.stringify(body) },
      );
      const result = (await response.json()) as { invoiceId?: unknown };
      if (typeof result.invoiceId !== 'string' || !result.invoiceId) {
        throw new VercelApiError(502, 'invoice submit');
      }
      return { invoiceId: result.invoiceId };
    },
    async setInstallationNotification(installationId, notification) {
      await call('installation update', `/v1/installations/${encodeURIComponent(installationId)}`, {
        method: 'PATCH',
        body: JSON.stringify({ notification }),
      });
    },
  };
}
