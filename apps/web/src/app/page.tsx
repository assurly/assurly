import { type ReactElement } from 'react';
import { headers } from 'next/headers';
import HomeClient from './_components/home/HomeClient';
import { OAuthCodeRecovery } from './_components/home/OAuthCodeRecovery';
import { getSessionUser } from '../utils/auth';
import { resolveApplicationUrlFromHost } from '../utils/env';

const OAUTH_CODE = /^[A-Za-z0-9._~-]{1,2048}$/;

interface HomePageProps {
  searchParams: Promise<{ code?: string | string[] }>;
}

export default async function HomePage({ searchParams }: HomePageProps): Promise<ReactElement> {
  const requestHeaders = await headers();
  const appUrl = resolveApplicationUrlFromHost(
    requestHeaders.get('x-forwarded-host') ?? requestHeaders.get('host'),
    requestHeaders.get('x-forwarded-proto'),
  );
  const code = (await searchParams).code;
  if (typeof code === 'string' && OAUTH_CODE.test(code)) {
    const callbackUrl = new URL('/api/auth/callback', appUrl);
    callbackUrl.searchParams.set('code', code);
    return <OAuthCodeRecovery callbackUrl={callbackUrl.toString()} />;
  }

  const user = await getSessionUser(
    new Request('http://shipready.local/', {
      headers: { cookie: requestHeaders.get('cookie') ?? '' },
    }),
  );

  return (
    <HomeClient
      initialAuthenticated={user !== null}
      loginUrl={new URL('/api/auth/login', appUrl).toString()}
    />
  );
}
