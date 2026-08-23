import { headers } from 'next/headers';
import { getSessionUser } from './auth';
import { resolveApplicationUrlFromHost } from './env';

export interface SiteNavAuth {
  authenticated: boolean;
  loginUrl: string;
}

/**
 * Session + canonical login URL for marketing chrome (`HomeHeader` on /mcp,
 * legal pages, and other product pages that reuse the landing nav).
 */
export async function resolveSiteNavAuth(): Promise<SiteNavAuth> {
  const requestHeaders = await headers();
  const appUrl = resolveApplicationUrlFromHost(
    requestHeaders.get('x-forwarded-host') ?? requestHeaders.get('host'),
    requestHeaders.get('x-forwarded-proto'),
  );
  const user = await getSessionUser(
    new Request('http://assurly.local/', {
      headers: { cookie: requestHeaders.get('cookie') ?? '' },
    }),
  );

  return {
    authenticated: user !== null,
    loginUrl: new URL('/api/auth/login', appUrl).toString(),
  };
}
