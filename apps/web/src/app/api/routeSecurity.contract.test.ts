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
import { DELETE as scansDelete, GET as scansRead, POST as scansCreate } from './scans/route';
import { POST as stripeCheckout } from './stripe/checkout/route';
import { POST as stripePortal } from './stripe/portal/route';
import { POST as stripeWebhook } from './stripe/webhook/route';

interface RouteContract {
  name: string;
  method: 'GET' | 'POST' | 'DELETE';
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
  { name: 'scans read', method: 'GET', auth: 'required', csrf: false, handler: scansRead },
  { name: 'scans create', method: 'POST', auth: 'required', csrf: true, handler: scansCreate },
  { name: 'scans delete', method: 'DELETE', auth: 'required', csrf: true, handler: scansDelete },
  {
    name: 'Stripe checkout',
    method: 'POST',
    auth: 'required',
    csrf: true,
    handler: stripeCheckout,
  },
  { name: 'Stripe portal', method: 'POST', auth: 'required', csrf: true, handler: stripePortal },
  { name: 'Stripe webhook', method: 'POST', auth: 'none', csrf: false, handler: stripeWebhook },
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
