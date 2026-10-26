import { after, NextResponse } from 'next/server';
import { z } from 'zod';
import {
  ApiError,
  emptyObjectSchema,
  RATE_LIMITS,
  secureRoute,
} from '../../../../../utils/apiSecurity';
import { getAdminDbAdapter } from '../../../../../utils/dbAdapter';
import { getApplicationUrl } from '../../../../../utils/env';
import { probeDeployment } from '../../../../../utils/liveLock';
import { readIntegrationEvent } from '../../../../../utils/liveLockCheck';
import {
  registerDeploymentCheck,
  rerunDeploymentCheck,
  startDeploymentCheck,
  type DeploymentCheckDeps,
  type DeploymentCheckRun,
} from '../../../../../utils/liveLockDeploymentCheck';
import {
  createVercelIntegrationApi,
  getVercelIntegrationSecret,
} from '../../../../../utils/vercelIntegration';
import { decryptVercelToken, encryptVercelToken } from '../../../../../utils/vercelToken';
import { handleInvoiceEvent } from '../../../../../utils/vercelMarketplace';
import { createVercelMarketplaceApi } from '../../../../../utils/vercelMarketplaceApi';
import { marketplaceDeps } from '../../../../../utils/vercelMarketplaceRoute';
import { verifyVercelWebhookSignature } from '../../../../../utils/vercelWebhook';
import {
  connectResource,
  disconnectResource,
  startCheckRun,
  type NativeLockDeps,
} from '../../../../../utils/liveLockNative';

/** The probe budget plus room to send the conclusion. */
export const maxDuration = 300;

/**
 * Live Lock's Vercel integration webhook.
 *
 * - The raw body is verified against the integration client secret before
 *   anything is parsed or looked up.
 * - The payload names a project and a deployment. It never chooses what is
 *   probed: the project must already be locked to a verified URL in our DB,
 *   and the probe goes to that deployment's generated `*.vercel.app` URL.
 * - Vercel retries for 24 hours on a non-2xx and gives a delivery 30 seconds,
 *   so the check is registered or marked running inline and the probe runs in
 *   `after()`. Each run is claimed once, so a redelivery never probes twice.
 */
export const POST = secureRoute(
  {
    routeId: 'vercel:integration:webhook',
    auth: 'none',
    query: emptyObjectSchema,
    params: emptyObjectSchema,
    body: z.string().max(1024 * 1024),
    bodyMode: 'raw',
    maxBodyBytes: 1024 * 1024,
    rateLimit: RATE_LIMITS.webhook,
  },
  async ({ request, body, requestId }) => {
    const secret = getVercelIntegrationSecret();
    if (!verifyVercelWebhookSignature(body, request.headers.get('x-vercel-signature'), secret)) {
      throw new ApiError(401, 'invalid_signature', 'Invalid webhook signature.');
    }

    let raw: unknown;
    try {
      raw = JSON.parse(body);
    } catch {
      throw new ApiError(400, 'invalid_json', 'Request body must be valid JSON.');
    }

    const event = readIntegrationEvent(raw);
    const db = getAdminDbAdapter();
    const deps: DeploymentCheckDeps = {
      db,
      apiFor: (connection) =>
        createVercelIntegrationApi(
          decryptVercelToken(connection.token_ciphertext),
          connection.team_id,
        ),
      probe: (target, deploymentUrl, bypassSecret) =>
        probeDeployment({ target, deploymentUrl, bypassSecret }),
      bypass: {
        read: async (targetId, vercelProjectId) => {
          const stored = await db.getLiveLockBypass(targetId);
          if (!stored || stored.vercel_project_id !== vercelProjectId) return null;
          return decryptVercelToken(stored.secret_ciphertext);
        },
        save: (target, vercelProjectId, secret) =>
          db.saveLiveLockBypass(
            target.id,
            target.organization_id,
            vercelProjectId,
            encryptVercelToken(secret),
          ),
        remove: (targetId) => db.deleteLiveLockBypass(targetId),
      },
      detailsUrl: () => `${getApplicationUrl()}/dashboard`,
      // VercelApiError carries Vercel's code and message, never the secret.
      onBypassError: (error) =>
        console.error(
          JSON.stringify({
            service: 'assurly-api',
            requestId,
            route: 'vercel:integration:webhook:bypass',
            status: 'failed',
            errorType: error instanceof Error ? error.name : 'UnknownError',
            errorMessage: error instanceof Error ? error.message : String(error),
          }),
        ),
    };

    const native: NativeLockDeps = {
      db,
      probe: deps.probe,
      bypass: deps.bypass,
      onBypassError: deps.onBypassError,
      detailsUrl: deps.detailsUrl,
      decryptToken: decryptVercelToken,
      marketplaceApiFor: (token) => createVercelMarketplaceApi(token),
      integrationApiFor: (token) => createVercelIntegrationApi(token, null),
    };

    let run: DeploymentCheckRun | null = null;
    switch (event.type) {
      case 'integration-resource.project-connected':
        return NextResponse.json({ message: await connectResource(event, native) });
      case 'integration-resource.project-disconnected':
        await disconnectResource(event, native);
        return NextResponse.json({ message: 'Disconnected.' });
      case 'deployment.checkrun.start':
        run = await startCheckRun(event, native);
        break;
      case 'marketplace.invoice':
        return NextResponse.json({ message: await handleInvoiceEvent(event, marketplaceDeps()) });
      case 'ignored':
        return NextResponse.json({ message: 'Event ignored.' });
      case 'integration-configuration.removed':
        await db.removeVercelConnection(event.configurationId);
        return NextResponse.json({ message: 'Connection removed.' });
      case 'deployment.created': {
        const row = await registerDeploymentCheck(event, deps);
        return NextResponse.json({ message: row ? 'Check registered.' : 'Not locked.' });
      }
      case 'deployment.ready':
        run = await startDeploymentCheck(event, deps);
        break;
      case 'deployment.check-rerequested':
        run = await rerunDeploymentCheck(event, deps);
        break;
    }

    if (!run) return NextResponse.json({ message: 'Nothing to run.' });
    const pending = run;
    after(async () => {
      try {
        await pending();
      } catch (error) {
        console.error(
          JSON.stringify({
            service: 'assurly-api',
            requestId,
            route: 'vercel:integration:webhook:run',
            status: 'failed',
            errorType: error instanceof Error ? error.name : 'UnknownError',
          }),
        );
      }
    });
    return NextResponse.json({ message: 'Check running.' }, { status: 202 });
  },
);
