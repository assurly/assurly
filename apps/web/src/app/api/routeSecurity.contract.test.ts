import { describe, expect, it } from 'vitest';
import type { SecuredRouteHandler, AuthMode } from '../../utils/apiSecurity';
import { GET as authCallback } from './auth/callback/route';
import { GET as authLogin } from './auth/login/route';
import { POST as authLogout } from './auth/logout/route';
import { GET as authSession } from './auth/session/route';
import { POST as contact } from './contact/route';
import { POST as githubFix } from './github/fix/route';
import { GET as githubInstall } from './github/install/route';
import { GET as githubInstallStart } from './github/install/start/route';
import { GET as githubProxy } from './github/proxy/route';
import { GET as githubDiscover } from './github/discover/route';
import { GET as githubPublicScan } from './github/public-scan/route';
import { POST as githubWebhook } from './github/webhook/route';
import { POST as repositories } from './repositories/route';
import { GET as repositoryScanCounts } from './repositories/scan-counts/route';
import {
  DELETE as repositoriesDelete,
  PATCH as repositoriesPatch,
} from './repositories/[id]/route';
import { DELETE as apiKeysDelete } from './api-keys/[id]/route';
import { DELETE as scansDelete, GET as scansRead, POST as scansCreate } from './scans/route';
import { GET as targetsRead, POST as targetsCreate } from './targets/route';
import { DELETE as targetsDelete } from './targets/[id]/route';
import { GET as findingCode } from './findings/[id]/code/route';
import { POST as liveLock } from './v1/live-lock/route';
import { POST as liveLockEnable } from './targets/[id]/live-lock/enable/route';
import { POST as liveLockMode } from './targets/[id]/live-lock/mode/route';
import { GET as vercelIntegrationCallback } from './vercel/integration/callback/route';
import { POST as vercelIntegrationWebhook } from './vercel/integration/webhook/route';
import {
  DELETE as marketplaceInstallationDelete,
  GET as marketplaceInstallationGet,
  PATCH as marketplaceInstallationPatch,
  PUT as marketplaceInstallationPut,
} from './vercel/marketplace/v1/installations/[installationId]/route';
import { GET as marketplaceInstallationPlans } from './vercel/marketplace/v1/installations/[installationId]/plans/route';
import { POST as marketplaceResourceProvision } from './vercel/marketplace/v1/installations/[installationId]/resources/route';
import {
  DELETE as marketplaceResourceDelete,
  GET as marketplaceResourceGet,
  PATCH as marketplaceResourcePatch,
} from './vercel/marketplace/v1/installations/[installationId]/resources/[resourceId]/route';
import { GET as marketplaceProductPlans } from './vercel/marketplace/v1/products/[productSlug]/plans/route';
import { POST as stripeCheckout } from './stripe/checkout/route';
import { POST as stripePortal } from './stripe/portal/route';
import { POST as stripeWebhook } from './stripe/webhook/route';
import { POST as v1Scans } from './v1/scans/route';
import { POST as v1Canary } from './v1/canary/route';
import { GET as canaryCallback, POST as canaryCallbackPost } from './canary/[token]/route';
import { GET as canaryList, POST as canaryIssue } from './targets/[id]/canary/route';
import { POST as canaryPlant } from './targets/[id]/canary/plant/route';
import { DELETE as canaryDelete } from './targets/[id]/canary/[tokenId]/route';
import { POST as canaryRevoke } from './targets/[id]/canary/[tokenId]/revoke/route';
import { POST as dependencyProvenance } from './dependencies/provenance/route';

interface RouteContract {
  name: string;
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  auth: AuthMode;
  csrf: boolean;
  handler: SecuredRouteHandler<unknown, unknown, unknown>;
}

const routes: RouteContract[] = [
  { name: 'auth callback', method: 'GET', auth: 'none', csrf: false, handler: authCallback },
  { name: 'auth login', method: 'GET', auth: 'none', csrf: false, handler: authLogin },
  { name: 'auth logout', method: 'POST', auth: 'optional', csrf: true, handler: authLogout },
  { name: 'auth session', method: 'GET', auth: 'optional', csrf: false, handler: authSession },
  { name: 'contact', method: 'POST', auth: 'none', csrf: true, handler: contact },
  { name: 'GitHub fix', method: 'POST', auth: 'required', csrf: true, handler: githubFix },
  { name: 'GitHub install', method: 'GET', auth: 'required', csrf: false, handler: githubInstall },
  {
    name: 'GitHub install start',
    method: 'GET',
    auth: 'required',
    csrf: false,
    handler: githubInstallStart,
  },
  { name: 'GitHub proxy', method: 'GET', auth: 'required', csrf: false, handler: githubProxy },
  {
    name: 'GitHub discover',
    method: 'GET',
    auth: 'optional',
    csrf: false,
    handler: githubDiscover,
  },
  {
    name: 'GitHub public scan',
    method: 'GET',
    auth: 'optional',
    csrf: false,
    handler: githubPublicScan,
  },
  { name: 'GitHub webhook', method: 'POST', auth: 'none', csrf: false, handler: githubWebhook },
  { name: 'repositories', method: 'POST', auth: 'required', csrf: true, handler: repositories },
  {
    name: 'repositories scan counts',
    method: 'GET',
    auth: 'required',
    csrf: false,
    handler: repositoryScanCounts,
  },
  {
    name: 'repositories patch',
    method: 'PATCH',
    auth: 'required',
    csrf: true,
    handler: repositoriesPatch,
  },
  {
    name: 'repositories delete',
    method: 'DELETE',
    auth: 'required',
    csrf: true,
    handler: repositoriesDelete,
  },
  { name: 'scans read', method: 'GET', auth: 'required', csrf: false, handler: scansRead },
  { name: 'finding code', method: 'GET', auth: 'required', csrf: false, handler: findingCode },
  {
    name: 'v1 live lock',
    method: 'POST',
    auth: 'apiKey',
    csrf: false,
    handler: liveLock,
  },
  {
    name: 'live lock enable',
    method: 'POST',
    auth: 'required',
    csrf: true,
    handler: liveLockEnable,
  },
  {
    name: 'live lock mode',
    method: 'POST',
    auth: 'required',
    csrf: true,
    handler: liveLockMode,
  },
  {
    name: 'vercel integration callback',
    method: 'GET',
    auth: 'required',
    csrf: false,
    handler: vercelIntegrationCallback,
  },
  {
    name: 'vercel integration webhook',
    method: 'POST',
    auth: 'none',
    csrf: false,
    handler: vercelIntegrationWebhook,
  },
  { name: 'scans create', method: 'POST', auth: 'required', csrf: true, handler: scansCreate },
  { name: 'scans delete', method: 'DELETE', auth: 'required', csrf: true, handler: scansDelete },
  {
    name: 'API keys delete',
    method: 'DELETE',
    auth: 'required',
    csrf: true,
    handler: apiKeysDelete,
  },
  {
    name: 'Stripe checkout',
    method: 'POST',
    auth: 'required',
    csrf: true,
    handler: stripeCheckout,
  },
  { name: 'Stripe portal', method: 'POST', auth: 'required', csrf: true, handler: stripePortal },
  { name: 'Stripe webhook', method: 'POST', auth: 'none', csrf: false, handler: stripeWebhook },
  {
    name: 'canary callback',
    method: 'GET',
    auth: 'none',
    csrf: false,
    handler: canaryCallback,
  },
  {
    name: 'canary callback post',
    method: 'POST',
    auth: 'none',
    csrf: false,
    handler: canaryCallbackPost,
  },
  {
    name: 'canary list',
    method: 'GET',
    auth: 'required',
    csrf: false,
    handler: canaryList,
  },
  {
    name: 'canary issue',
    method: 'POST',
    auth: 'required',
    csrf: true,
    handler: canaryIssue,
  },
  {
    name: 'canary plant',
    method: 'POST',
    auth: 'required',
    csrf: true,
    handler: canaryPlant,
  },
  {
    name: 'canary revoke',
    method: 'POST',
    auth: 'required',
    csrf: true,
    handler: canaryRevoke,
  },
  {
    name: 'canary delete',
    method: 'DELETE',
    auth: 'required',
    csrf: true,
    handler: canaryDelete,
  },

  {
    name: 'dependency provenance',
    method: 'POST',
    auth: 'required',
    csrf: true,
    handler: dependencyProvenance,
  },
  {
    name: 'v1 scans submit',
    method: 'POST',
    auth: 'apiKey',
    csrf: false,
    handler: v1Scans,
  },
  {
    name: 'v1 canary issue',
    method: 'POST',
    auth: 'apiKey',
    csrf: false,
    handler: v1Canary,
  },
  { name: 'targets read', method: 'GET', auth: 'required', csrf: false, handler: targetsRead },
  { name: 'targets create', method: 'POST', auth: 'required', csrf: true, handler: targetsCreate },
  {
    name: 'targets delete',
    method: 'DELETE',
    auth: 'required',
    csrf: true,
    handler: targetsDelete,
  },
  {
    name: 'marketplace installation upsert',
    method: 'PUT',
    auth: 'none',
    csrf: false,
    handler: marketplaceInstallationPut as SecuredRouteHandler<unknown, unknown, unknown>,
  },
  {
    name: 'marketplace installation get',
    method: 'GET',
    auth: 'none',
    csrf: false,
    handler: marketplaceInstallationGet as SecuredRouteHandler<unknown, unknown, unknown>,
  },
  {
    name: 'marketplace installation update',
    method: 'PATCH',
    auth: 'none',
    csrf: false,
    handler: marketplaceInstallationPatch as SecuredRouteHandler<unknown, unknown, unknown>,
  },
  {
    name: 'marketplace installation delete',
    method: 'DELETE',
    auth: 'none',
    csrf: false,
    handler: marketplaceInstallationDelete as SecuredRouteHandler<unknown, unknown, unknown>,
  },
  {
    name: 'marketplace installation plans',
    method: 'GET',
    auth: 'none',
    csrf: false,
    handler: marketplaceInstallationPlans as SecuredRouteHandler<unknown, unknown, unknown>,
  },
  {
    name: 'marketplace resource provision',
    method: 'POST',
    auth: 'none',
    csrf: false,
    handler: marketplaceResourceProvision as SecuredRouteHandler<unknown, unknown, unknown>,
  },
  {
    name: 'marketplace resource get',
    method: 'GET',
    auth: 'none',
    csrf: false,
    handler: marketplaceResourceGet as SecuredRouteHandler<unknown, unknown, unknown>,
  },
  {
    name: 'marketplace resource update',
    method: 'PATCH',
    auth: 'none',
    csrf: false,
    handler: marketplaceResourcePatch as SecuredRouteHandler<unknown, unknown, unknown>,
  },
  {
    name: 'marketplace resource delete',
    method: 'DELETE',
    auth: 'none',
    csrf: false,
    handler: marketplaceResourceDelete as SecuredRouteHandler<unknown, unknown, unknown>,
  },
  {
    name: 'marketplace product plans',
    method: 'GET',
    auth: 'none',
    csrf: false,
    handler: marketplaceProductPlans as SecuredRouteHandler<unknown, unknown, unknown>,
  },
];

describe('API route security contract', () => {
  it.each(routes)(
    '$name has Zod validation wired before the handler',
    async ({ method, handler }) => {
      const response = await handler(
        new Request(`http://localhost/api/contract?unexpected=true`, { method }),
      );
      expect(response.status).toBe(400);
      expect((await response.json()).error.code).toBe('invalid_request');
    },
  );

  it.each(routes)('$name declares its authorization boundary', ({ auth, handler }) => {
    expect(handler.security.auth).toBe(auth);
  });

  it.each(routes)('$name declares the correct cookie-CSRF policy', ({ csrf, handler }) => {
    expect(Boolean(handler.security.csrf)).toBe(csrf);
  });

  it.each(routes)('$name declares database-compatible rate and payload limits', ({ handler }) => {
    expect(handler.security.rateLimit.limit).toBeGreaterThan(0);
    expect(handler.security.rateLimit.windowSeconds).toBeGreaterThan(0);
    expect(handler.security.maxBodyBytes).toBeGreaterThanOrEqual(0);
    expect(handler.security.query.safeParse).toBeTypeOf('function');
    expect(handler.security.params.safeParse({ unexpected: 'value' }).success).toBe(false);
    expect(handler.security.body.safeParse).toBeTypeOf('function');
  });
});
