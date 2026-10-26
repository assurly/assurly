import type { Metadata } from 'next';
import React, { type ReactElement } from 'react';
import Link from 'next/link';
import { SiteFooter } from '../_components/SiteFooter';
import { SiteNavHeader } from '../_components/home/SiteNavHeader';
import { StructuredData } from '../_components/StructuredData';
import { CONTACT_SUBJECT_PARAM } from '../../utils/contactSubjects';
import { SITE_OG_IMAGE } from '../../utils/siteMetadata';
import { resolveSiteNavAuth } from '../../utils/siteNavAuth';
import { subPageGraph } from '../../utils/structuredData';

const CONTACT_HREF = `/?${CONTACT_SUBJECT_PARAM}=technical#contact`;

const PAGE_TITLE = 'Live Lock for Vercel · Assurly';
const PAGE_DESCRIPTION =
  'How Assurly Live Lock checks every Vercel production deployment before it reaches your domain: setup, monitor and enforce modes, what can hold a deploy, and what never does.';

export const metadata: Metadata = {
  title: PAGE_TITLE,
  description: PAGE_DESCRIPTION,
  openGraph: {
    title: PAGE_TITLE,
    description: PAGE_DESCRIPTION,
    type: 'website',
    url: '/live-lock',
    images: [SITE_OG_IMAGE],
  },
  twitter: {
    card: 'summary_large_image',
    title: PAGE_TITLE,
    description: PAGE_DESCRIPTION,
  },
  alternates: {
    canonical: '/live-lock',
  },
};

export default async function LiveLockPage(): Promise<ReactElement> {
  const { authenticated, loginUrl } = await resolveSiteNavAuth();

  return (
    <div className="legal-container">
      <StructuredData
        graph={subPageGraph('/live-lock', 'Live Lock for Vercel', PAGE_DESCRIPTION)}
      />
      <SiteNavHeader authenticated={authenticated} loginUrl={loginUrl} />

      <main className="legal-content">
        <h1>Live Lock for Vercel</h1>
        <p className="last-updated">Last updated: October 26, 2026</p>

        <section className="legal-section">
          <h2>What it does</h2>
          <p>
            Live Lock puts a check named <em>Assurly Live Lock</em> on every production deployment
            of a Vercel project you choose. When the build is ready, Assurly makes a fresh,
            read-only check of that exact deployment on its generated <code>*.vercel.app</code>{' '}
            address. Vercel holds the deployment off your domain until the check reports back, and
            keeps the previous deployment live if the check fails.
          </p>
        </section>

        <section className="legal-section">
          <h2>Set it up</h2>
          <ol>
            <li>
              Verify that you own the URL in the Assurly dashboard. Live Lock only ever checks
              domains you have verified.
            </li>
            <li>
              Open the app in your dashboard and choose <em>Protect production deploys</em>. Vercel
              asks you to install the Assurly Live Lock integration for your team.
            </li>
            <li>
              Assurly links the Vercel project that lists your domain as a production domain. If no
              project does, you pick one from your team and Assurly confirms it serves the domain.
            </li>
          </ol>
          <p>
            A new lock starts in <strong>monitor</strong> mode. You switch it yourself.
          </p>
        </section>

        <section className="legal-section">
          <h2>Monitor and enforce</h2>
          <ul>
            <li>
              <strong>Monitor</strong> checks every production deployment and never holds one. The
              dashboard shows which deployments would have been held back.
            </li>
            <li>
              <strong>Enforce</strong> fails the check, and so keeps production on the previous
              deployment, only when the check proves a high-severity finding with high confidence.
              Zero such findings is a pass.
            </li>
          </ul>
          <p>
            A mode change applies from the next deployment Vercel creates. You can ship a held
            deployment at any time with Force Promote in Vercel.
          </p>
        </section>

        <section className="legal-section">
          <h2>What never holds a deploy</h2>
          <p>
            If Assurly cannot decide, the check ends as <em>neutral</em> and Vercel releases the
            deployment. That covers a protected deployment Assurly could not get into, a deployment
            that refuses the check, a check that runs out of time, an outage on our side, and a
            domain whose ownership is no longer verified. The dashboard marks these deployments as
            not verified, so a skipped check is never shown as a pass.
          </p>
        </section>

        <section className="legal-section">
          <h2>Projects with Deployment Protection</h2>
          <p>
            A protected deployment sends visitors to a Vercel login, so Assurly cannot see the
            build. With the setup on this page, those deployments are released and marked as not
            verified: Vercel lets only integrations installed from the Vercel Marketplace create a
            Protection Bypass for Automation.
          </p>
          <p>
            Live Lock installed from the Vercel Marketplace checks protected projects too. It is in
            review with Vercel; see{' '}
            <Link href="/live-lock/getting-started">Get started with Live Lock on Vercel</Link>.
          </p>
        </section>

        <section className="legal-section">
          <h2>What Assurly reads, and what it stores</h2>
          <ul>
            <li>
              The check is read-only and uses the same passive and active probes as the rest of
              Assurly, limited to your verified domain.
            </li>
            <li>
              Assurly stores the deployment id, commit, result, score and the rule and message of
              each blocker. It does not store probe samples for these checks.
            </li>
            <li>
              The integration asks Vercel for access to read your projects and deployments and to
              write deployment checks. It does not change your domains, environment variables or any
              bypass you created. The installation token is encrypted and never shown.
            </li>
          </ul>
        </section>

        <section className="legal-section">
          <h2>Turn it off</h2>
          <p>
            Choose <em>Turn off</em> in the dashboard, or remove the integration in Vercel. Removing
            it deletes the stored token and every lock it powered.
          </p>
        </section>

        <section className="legal-section">
          <h2>Other deploy platforms and CI</h2>
          <p>
            For any platform, <code>POST /api/v1/live-lock</code> with an Assurly API key returns{' '}
            <code>ready</code> or <code>blocked</code> for a URL and commit. The{' '}
            <Link href="/mcp">MCP tool</Link> and the CLI use the same check.
          </p>
        </section>

        <section className="legal-section">
          <h2>Questions</h2>
          <p>
            Reach us through <Link href={CONTACT_HREF}>the contact form</Link>.
          </p>
        </section>
      </main>
      <SiteFooter variant="full" />
    </div>
  );
}
