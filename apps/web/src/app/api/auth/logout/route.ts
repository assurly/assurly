import { NextResponse } from 'next/server';
import {
  emptyBodySchema,
  emptyObjectSchema,
  RATE_LIMITS,
  secureRoute,
} from '../../../../utils/apiSecurity';
import {
  clearLegacySupabaseAuthCookies,
  clearSessionCookie,
  parseSessionCookie,
} from '../../../../utils/auth';
import { getApplicationUrl } from '../../../../utils/env';
import { createStatelessSupabaseClient } from '../../../../utils/supabase';

export const POST = secureRoute(
  {
    routeId: 'auth:logout',
    auth: 'optional',
    query: emptyObjectSchema,
    params: emptyObjectSchema,
    body: emptyBodySchema,
    bodyMode: 'none',
    maxBodyBytes: 0,
    rateLimit: RATE_LIMITS.sensitive,
    csrf: true,
  },
  async ({ request }) => {
    // Revoke the Supabase session server-side so the refresh token is
    // invalidated immediately. The canonical session lives only in the
    // `shipready-session` cookie, so we bind those tokens to a stateless client
    // and sign out globally. A stale, un-revoked refresh token would otherwise
    // remain usable until natural expiry even after the user logs out.
    const session = parseSessionCookie(request);
    if (session) {
      try {
        const supabase = createStatelessSupabaseClient();
        await supabase.auth.setSession({
          access_token: session.accessToken,
          refresh_token: session.refreshToken,
        });
        await supabase.auth.signOut({ scope: 'global' });
      } catch {
        // Non-fatal: proceed with cookie clear even if Supabase revocation fails.
      }
    }

    const response = NextResponse.redirect(`${getApplicationUrl()}/`);
    response.headers.append('Set-Cookie', clearSessionCookie());
    // Also expire any legacy duplicate Supabase session cookies from older builds.
    for (const header of clearLegacySupabaseAuthCookies(request)) {
      response.headers.append('Set-Cookie', header);
    }
    return response;
  },
);
