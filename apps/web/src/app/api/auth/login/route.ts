import { NextResponse } from 'next/server';
import {
  assertTrustedRedirect,
  emptyBodySchema,
  emptyObjectSchema,
  RATE_LIMITS,
  secureRoute,
} from '../../../../utils/apiSecurity';
import { getSupabaseConfig, resolveApplicationUrlFromRequest } from '../../../../utils/env';
import { getServerSupabaseClient } from '../../../../utils/supabase';

export const GET = secureRoute(
  {
    routeId: 'auth:login',
    auth: 'none',
    query: emptyObjectSchema,
    params: emptyObjectSchema,
    body: emptyBodySchema,
    bodyMode: 'none',
    maxBodyBytes: 0,
    rateLimit: RATE_LIMITS.sensitive,
  },
  async ({ request }) => {
    const appUrl = resolveApplicationUrlFromRequest(request);
    const supabase = await getServerSupabaseClient();
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: 'github',
      options: {
        redirectTo: `${appUrl}/api/auth/callback`,
        scopes: 'repo',
        queryParams: { prompt: 'consent' },
      },
    });
    if (error || !data?.url) {
      return NextResponse.redirect(`${appUrl}/?error=auth_failed`);
    }
    const supabaseOrigin = new URL(getSupabaseConfig().url).origin;
    return NextResponse.redirect(assertTrustedRedirect(data.url, [supabaseOrigin]));
  },
);
