import { NextResponse } from 'next/server';
import { z } from 'zod';
import { emptyBodySchema, emptyObjectSchema, secureRoute } from '../../../../utils/apiSecurity';
import { clearLegacySupabaseAuthCookies, setSupabaseSessionCookie } from '../../../../utils/auth';
import { getUserDbAdapter } from '../../../../utils/dbAdapter';
import { resolveApplicationUrlFromRequest } from '../../../../utils/env';
import { getServerSupabaseClient } from '../../../../utils/supabase';

const callbackQuery = z
  .object({
    code: z
      .string()
      .min(1)
      .max(2048)
      .regex(/^[A-Za-z0-9._~-]+$/)
      .optional(),
  })
  .strict();

export const GET = secureRoute(
  {
    routeId: 'auth:callback',
    auth: 'none',
    query: callbackQuery,
    params: emptyObjectSchema,
    body: emptyBodySchema,
    bodyMode: 'none',
    maxBodyBytes: 0,
    rateLimit: { limit: 20, windowSeconds: 60 },
  },
  async ({ query, request }) => {
    const appUrl = resolveApplicationUrlFromRequest(request);
    if (!query.code) return NextResponse.redirect(`${appUrl}/?error=missing_code`);

    const supabase = await getServerSupabaseClient();
    const { data, error } = await supabase.auth.exchangeCodeForSession(query.code);
    if (error || !data.session) {
      return NextResponse.redirect(`${appUrl}/?error=auth_failed`);
    }

    const userDb = getUserDbAdapter(data.session.access_token);
    const userId = data.session.user.id;
    if (!(await userDb.getOrganizationByUserId(userId))) {
      const name =
        data.session.user.user_metadata?.full_name ||
        data.session.user.user_metadata?.name ||
        'Developer';
      await userDb.createOrganization(`${String(name).slice(0, 80)}'s Workspace`);
    }

    // `welcome=1` triggers the one-time post-login splash on the dashboard; the
    // client strips the param on mount so a refresh never replays it.
    const response = NextResponse.redirect(`${appUrl}/dashboard?welcome=1`);
    // Use append so the PKCE code-verifier clearing cookie emitted by
    // exchangeCodeForSession above is preserved. Using set() would replace all
    // Set-Cookie headers with only assurly-session. The session itself is
    // stored solely in assurly-session (see utils/supabase for why the SSR
    // client no longer persists its own sb-*-auth-token cookie).
    response.headers.append(
      'Set-Cookie',
      setSupabaseSessionCookie({
        accessToken: data.session.access_token,
        refreshToken: data.session.refresh_token,
        expiresAt: Math.floor(Date.now() / 1000) + (data.session.expires_in || 3600),
        githubAccessToken:
          typeof data.session.provider_token === 'string' && data.session.provider_token
            ? data.session.provider_token
            : undefined,
      }),
    );
    // Migrate away any legacy duplicate session cookies from older builds.
    for (const header of clearLegacySupabaseAuthCookies(request)) {
      response.headers.append('Set-Cookie', header);
    }
    return response;
  },
);
