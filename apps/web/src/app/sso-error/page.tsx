import type { Metadata } from 'next';
import Link from 'next/link';
import type { ReactElement } from 'react';
import { SiteFooter } from '../_components/SiteFooter';
import { SiteNavHeader } from '../_components/home/SiteNavHeader';
import { CONTACT_SUBJECT_PARAM } from '../../utils/contactSubjects';
import { resolveSiteNavAuth } from '../../utils/siteNavAuth';
import type { SsoFailure } from '../../utils/vercelSso';

export const metadata: Metadata = {
  title: 'Sign-in from Vercel did not finish · Assurly',
  robots: { index: false, follow: false },
};

/** What happened, and the one thing the person can do about it. */
export const SSO_FAILURE_COPY: Record<SsoFailure, { title: string; body: string }> = {
  not_configured: {
    title: 'Sign-in from Vercel is not available yet',
    body: 'Assurly is still being connected to the Vercel Marketplace. Please try again later.',
  },
  exchange_failed: {
    title: 'The sign-in link expired',
    body: 'Links from Vercel can be used once and only for a short time. Go back to Vercel and open Assurly again.',
  },
  invalid_token: {
    title: 'Vercel could not confirm who you are',
    body: 'Go back to Vercel and open Assurly again. If it keeps happening, contact support.',
  },
  unknown_installation: {
    title: 'This Vercel team has no Assurly installation',
    body: 'The integration may have been removed. Add Assurly from the Vercel Marketplace, then open it again.',
  },
  email_unverified: {
    title: 'Your Vercel email address is not verified',
    body: 'Assurly signs you in by the email address Vercel has verified. Verify it in your Vercel account settings, then open Assurly again.',
  },
  session_failed: {
    title: 'We could not sign you in',
    body: 'Something went wrong on our side. Please try again in a minute, or contact support.',
  },
};

function isFailure(value: unknown): value is SsoFailure {
  return typeof value === 'string' && Object.hasOwn(SSO_FAILURE_COPY, value);
}

export default async function SsoErrorPage({
  searchParams,
}: {
  searchParams: Promise<{ reason?: string | string[] }>;
}): Promise<ReactElement> {
  const { reason } = await searchParams;
  const copy = SSO_FAILURE_COPY[isFailure(reason) ? reason : 'session_failed'];
  const { authenticated, loginUrl } = await resolveSiteNavAuth();

  return (
    <div className="legal-container">
      <SiteNavHeader authenticated={authenticated} loginUrl={loginUrl} />
      <main className="legal-content">
        <h1>{copy.title}</h1>
        <section className="legal-section">
          <p>{copy.body}</p>
          <p>
            <a href="https://vercel.com/dashboard">Back to Vercel</a> ·{' '}
            <Link href={`/?${CONTACT_SUBJECT_PARAM}=technical#contact`}>Contact support</Link>
          </p>
        </section>
      </main>
      <SiteFooter variant="compact" />
    </div>
  );
}
