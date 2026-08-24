import { type ReactElement } from 'react';
import { headers } from 'next/headers';
import HomeClient from './_components/home/HomeClient';
import { OAuthCodeRecovery } from './_components/home/OAuthCodeRecovery';
import { StructuredData } from './_components/StructuredData';
import { getSessionUser } from '../utils/auth';
import {
  CONTACT_SUBJECT_PARAM,
  DEFAULT_CONTACT_SUBJECT,
  isContactSubject,
  type ContactSubject,
} from '../utils/contactSubjects';
import { resolveApplicationUrlFromHost } from '../utils/env';
import { publicPageUrl } from '../utils/siteMetadata';
import { homePageGraph } from '../utils/structuredData';

const OAUTH_CODE = /^[A-Za-z0-9._~-]{1,2048}$/;

/** Mirrors the description in layout.tsx, which is this page's own metadata. */
const HOME_DESCRIPTION =
  'Scan your deployed URL in 60 seconds, get a Ship Score, fix blockers with one click, and monitor every deploy — before you ship to Vercel, Supabase, and Stripe.';

interface HomePageProps {
  searchParams: Promise<{ code?: string | string[]; subject?: string | string[] }>;
}

/**
 * Resolves the `?subject=` deep link used by the Privacy Policy to land a visitor
 * on the contact form with the right category preselected. Anything unrecognised
 * falls back to the default, so a crafted link cannot inject arbitrary values.
 */
function resolveContactSubject(value: string | string[] | undefined): ContactSubject {
  const candidate = Array.isArray(value) ? value[0] : value;
  return isContactSubject(candidate) ? candidate : DEFAULT_CONTACT_SUBJECT;
}

export default async function HomePage({ searchParams }: HomePageProps): Promise<ReactElement> {
  const requestHeaders = await headers();
  const appUrl = resolveApplicationUrlFromHost(
    requestHeaders.get('x-forwarded-host') ?? requestHeaders.get('host'),
    requestHeaders.get('x-forwarded-proto'),
  );
  const resolvedSearchParams = await searchParams;
  const code = resolvedSearchParams.code;
  if (typeof code === 'string' && OAUTH_CODE.test(code)) {
    const callbackUrl = new URL('/api/auth/callback', appUrl);
    callbackUrl.searchParams.set('code', code);
    return <OAuthCodeRecovery callbackUrl={callbackUrl.toString()} />;
  }

  const user = await getSessionUser(
    new Request('http://assurly.local/', {
      headers: { cookie: requestHeaders.get('cookie') ?? '' },
    }),
  );

  return (
    <>
      {/* Next's Metadata API serializes the origin without a trailing slash.
          Sitemap loc and JSON-LD use `https://assurly.dev/`; a raw link is
          the one way to emit the same string. Child pages still set canonical
          through `alternates` — they are not origins, so Next leaves them intact. */}
      <link rel="canonical" href={publicPageUrl(appUrl, '/')} />
      <StructuredData graph={homePageGraph(HOME_DESCRIPTION)} />
      <HomeClient
        initialAuthenticated={user !== null}
        loginUrl={new URL('/api/auth/login', appUrl).toString()}
        initialContactSubject={resolveContactSubject(resolvedSearchParams[CONTACT_SUBJECT_PARAM])}
      />
    </>
  );
}
