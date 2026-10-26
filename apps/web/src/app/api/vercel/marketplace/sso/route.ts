import { NextResponse } from 'next/server';
import { z } from 'zod';
import {
  emptyBodySchema,
  emptyObjectSchema,
  RATE_LIMITS,
  secureRoute,
} from '../../../../../utils/apiSecurity';
import {
  clearLegacySupabaseAuthCookies,
  setSupabaseSessionCookie,
} from '../../../../../utils/auth';
import { getAdminDbAdapter } from '../../../../../utils/dbAdapter';
import { resolveApplicationUrlFromRequest } from '../../../../../utils/env';
import { getVercelIntegrationConfig } from '../../../../../utils/vercelIntegration';
import {
  completeVercelSso,
  createSupabaseSessionIssuer,
  exchangeSsoCode,
  SsoError,
  ssoDestination,
  verifySsoToken,
} from '../../../../../utils/vercelSso';

const param = (max: number) => z.string().min(1).max(max).optional();

/**
 * Vercel adds context parameters over time, so unknown ones are dropped rather
 * than rejected: a strict schema would turn a new Vercel parameter into a
 * failed sign-in. Only the ones read below are validated.
 */
const ssoQuery = z.object({
  code: z
    .string()
    .min(1)
    .max(2048)
    .regex(/^[A-Za-z0-9._~-]+$/)
    .optional(),
  state: param(2048),
  mode: param(20),
  resource_id: param(120),
  path: param(40),
  support: param(10),
  url: param(2048),
});

/**
 * The Marketplace `redirectLoginUrl`: "Open in Assurly" in the Vercel
 * dashboard lands here. Configure it in the Integration Console as
 * `<app>/api/vercel/marketplace/sso`.
 */
export const GET = secureRoute(
  {
    routeId: 'vercel:marketplace:sso',
    auth: 'none',
    query: ssoQuery,
    params: emptyObjectSchema,
    body: emptyBodySchema,
    bodyMode: 'none',
    maxBodyBytes: 0,
    rateLimit: RATE_LIMITS.sensitive,
  },
  async ({ request, query, requestId }) => {
    const appUrl = resolveApplicationUrlFromRequest(request);
    const config = getVercelIntegrationConfig();
    try {
      if (!config) throw new SsoError('not_configured');
      const signedIn = await completeVercelSso(query, {
        config,
        db: getAdminDbAdapter(),
        exchange: (code, state) => exchangeSsoCode(code, state, config),
        verify: verifySsoToken(config),
        issueSession: createSupabaseSessionIssuer(),
      });
      const response = NextResponse.redirect(ssoDestination(query, appUrl));
      response.headers.append('Set-Cookie', setSupabaseSessionCookie(signedIn.session));
      for (const cookie of clearLegacySupabaseAuthCookies(request)) {
        response.headers.append('Set-Cookie', cookie);
      }
      return response;
    } catch (error) {
      const reason = error instanceof SsoError ? error.reason : 'exchange_failed';
      console.error(
        JSON.stringify({
          service: 'assurly-api',
          requestId,
          route: 'vercel:marketplace:sso',
          status: 'failed',
          reason,
          errorType: error instanceof Error ? error.name : 'UnknownError',
          errorMessage: error instanceof Error ? error.message : String(error),
        }),
      );
      return NextResponse.redirect(`${new URL(appUrl).origin}/sso-error?reason=${reason}`);
    }
  },
);
