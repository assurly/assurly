import type { Metadata } from 'next';
import Link from 'next/link';
import type { ReactElement } from 'react';
import { SiteFooter } from '../../_components/SiteFooter';
import { SiteNavHeader } from '../../_components/home/SiteNavHeader';
import { CONTACT_SUBJECT_PARAM } from '../../../utils/contactSubjects';
import { PRO_MONTHLY_USD } from '../../../utils/vercelBilling';
import { resolveSiteNavAuth } from '../../../utils/siteNavAuth';

/**
 * The Documentation URL of the Vercel Marketplace listing: how a team installs
 * and uses Live Lock as a native integration.
 *
 * Every statement here must match the code: Partner API in
 * utils/vercelMarketplace.ts, checks in utils/liveLockNative.ts, billing in
 * utils/vercelBilling*.ts, SSO in utils/vercelSso.ts.
 *
 * Until Vercel approves the listing the page is reachable (reviewers read it)
 * but not indexed and not in the sitemap. Flip MARKETPLACE_LISTED on launch.
 */
export const MARKETPLACE_LISTED = false;

const CONTACT_HREF = `/?${CONTACT_SUBJECT_PARAM}=technical#contact`;
const PAGE_TITLE = 'Get started with Live Lock on Vercel · Assurly';
const PAGE_DESCRIPTION =
  'Install Assurly Live Lock from the Vercel Marketplace, connect it to a project and let every production deploy be checked before it reaches your domain.';

export const metadata: Metadata = {
  title: PAGE_TITLE,
  description: PAGE_DESCRIPTION,
  alternates: { canonical: '/live-lock/getting-started' },
  robots: MARKETPLACE_LISTED ? undefined : { index: false, follow: false },
};

export default async function LiveLockGettingStartedPage(): Promise<ReactElement> {
  const { authenticated, loginUrl } = await resolveSiteNavAuth();
  const proPrice = `$${PRO_MONTHLY_USD}`;

  return (
    <div className="legal-container">
      <SiteNavHeader authenticated={authenticated} loginUrl={loginUrl} />

      <main className="legal-content">
        <h1>Get started with Live Lock on Vercel</h1>
        <p className="last-updated">Last updated: October 26, 2026</p>

        {MARKETPLACE_LISTED ? null : (
          <section className="legal-section important-notice">
            <p>
              Live Lock is in review for the Vercel Marketplace. Until it is listed, you can turn it
              on from the Assurly dashboard as described on <Link href="/live-lock">Live Lock</Link>
              .
            </p>
          </section>
        )}

        <section className="legal-section">
          <h2>What Live Lock does</h2>
          <p>
            Live Lock adds a deployment check named <em>Assurly Live Lock</em> to a Vercel project.
            On every production deployment, Assurly makes a fresh, read-only check of that exact
            build on its generated <code>*.vercel.app</code> address. In Enforce mode Vercel keeps
            your production domains on the previous deployment when the check proves a high-severity
            blocker, such as a database table anyone can read or a secret in the browser bundle.
          </p>
        </section>

        <section className="legal-section">
          <h2>Before you start</h2>
          <ul>
            <li>A Vercel project that deploys to production.</li>
            <li>
              Permission to install integrations on the Vercel team. You do not need an Assurly
              account; one is made for your team when you install.
            </li>
          </ul>
        </section>

        <section className="legal-section">
          <h2>1. Add Live Lock</h2>
          <p>
            Open Assurly Live Lock in the Vercel Marketplace, choose <em>Install</em> and pick a
            plan for your team:
          </p>
          <ul>
            <li>
              <strong>Free</strong>: Monitor mode for one project.
            </li>
            <li>
              <strong>Pro</strong>: {proPrice} a month, Monitor or Enforce, unlimited projects, and
              the full Assurly dashboard.
            </li>
          </ul>
        </section>

        <section className="legal-section">
          <h2>2. Create a Live Lock and connect a project</h2>
          <ol>
            <li>
              Create a Live Lock, give it a name and choose <strong>Monitor</strong> or{' '}
              <strong>Enforce</strong>.
            </li>
            <li>
              Connect it to the project you want to guard. One Live Lock guards one project. Assurly
              checks the project&apos;s production domain; Vercel confirms your team owns it, so
              there is no DNS record or file to add.
            </li>
          </ol>
          <p>
            Vercel adds one environment variable, <code>ASSURLY_LIVE_LOCK_ID</code>, so a build or a
            support request can name the lock. Your code does not need it and nothing else changes
            in your project.
          </p>
        </section>

        <section className="legal-section">
          <h2>3. Deploy as usual</h2>
          <p>
            The <em>Assurly Live Lock</em> check appears under the project&apos;s Deployment Checks.
            When a production build is ready, Vercel starts it and Assurly answers with one of these
            results:
          </p>
          <ul>
            <li>
              <strong>Passed</strong>: no proven blocker. The deployment goes live.
            </li>
            <li>
              <strong>Held back</strong> (Enforce): a proven blocker, named in the check. Production
              stays on the previous deployment.
            </li>
            <li>
              <strong>Would be held back</strong> (Monitor): the same finding, reported without
              holding the deployment.
            </li>
            <li>
              <strong>Not verified</strong>: Assurly could not decide, so the deployment goes live
              unchecked. See below.
            </li>
          </ul>
          <p>
            Fix the blocker and deploy again, or use <em>Rerun</em> on the check. To ship a held
            deployment anyway, use <em>Force Promote</em> in Vercel.
          </p>
        </section>

        <section className="legal-section">
          <h2>Monitor and Enforce</h2>
          <p>
            Start with Monitor to see what Live Lock would hold back on your real deployments, then
            switch to Enforce in the Live Lock&apos;s settings in Vercel. Enforce needs the Pro
            plan. A change applies to the next production deployment.
          </p>
        </section>

        <section className="legal-section">
          <h2>What never holds a deploy</h2>
          <p>
            Only a finding Assurly proves on the live build, at high severity and high confidence,
            holds a deployment. A check that times out, a deployment that cannot be reached, an
            outage on our side, and every finding in Monitor mode end as neutral, and Vercel
            releases the deployment. The dashboard marks those deployments as not verified, so a
            skipped check is never shown as a pass.
          </p>
        </section>

        <section className="legal-section">
          <h2>Projects with Deployment Protection</h2>
          <p>
            A protected deployment sends visitors to a Vercel login. When a check runs into that,
            Live Lock creates its own Protection Bypass for Automation on the project and checks
            again. The bypass is sent only to that deployment&apos;s own address, never to your
            database or any other service. It is revoked when you disconnect the project and removed
            when you uninstall.
          </p>
        </section>

        <section className="legal-section">
          <h2>Open in Assurly</h2>
          <p>
            <em>Open in Assurly</em> on the integration or on a check signs you in with the email
            address your Vercel account has verified, and opens your team&apos;s workspace. Team
            admins in Vercel are admins in Assurly; other members get member access. If you already
            use Assurly with the same email, it is the same account, and the workspace switcher in
            the dashboard moves between your workspaces.
          </p>
        </section>

        <section className="legal-section">
          <h2>Billing</h2>
          <ul>
            <li>Charges appear on your Vercel invoice. Vercel handles tax and payment.</li>
            <li>
              Pro is billed monthly in arrears for the calendar month (UTC), prorated by the time
              your team spent on Pro. Nothing is charged in advance, so moving to Free is never
              refunded or penalised.
            </li>
            <li>Your Vercel dashboard shows the running total for the current month.</li>
            <li>
              If an invoice becomes overdue, Enforce pauses (checks still report) until it is paid.
              Nothing is deleted.
            </li>
          </ul>
        </section>

        <section className="legal-section">
          <h2>What Assurly reads, and what it stores</h2>
          <ul>
            <li>
              From Vercel: your team name and contact email, the connected project and its
              production domain, the deployments Live Lock checks, and for Open in Assurly your name
              and verified email.
            </li>
            <li>
              The check is read-only and limited to the deployment&apos;s own address. Assurly
              stores the deployment id, commit, result, score and the rule and message of each
              blocker, not the data a probe saw.
            </li>
            <li>
              The installation token and the protection bypass are encrypted and never shown. Live
              Lock does not change your domains, environment variables (other than adding{' '}
              <code>ASSURLY_LIVE_LOCK_ID</code>) or any bypass you created.
            </li>
          </ul>
          <p>
            Details are in the <Link href="/privacy">Privacy Policy</Link> and the{' '}
            <Link href="/terms">Terms</Link>.
          </p>
        </section>

        <section className="legal-section">
          <h2>Disconnect or uninstall</h2>
          <p>
            Disconnecting a project removes its check and bypass; its history stays in the
            dashboard. Uninstalling the integration removes every check, bypass and stored token,
            and sends the final invoice for Pro time not yet billed.
          </p>
        </section>

        <section className="legal-section">
          <h2>Support</h2>
          <p>
            Use <em>Support</em> on the integration in Vercel,{' '}
            <Link href={CONTACT_HREF}>the contact form</Link>, or{' '}
            <a href="mailto:support@assurly.dev">support@assurly.dev</a>.
          </p>
        </section>
      </main>
      <SiteFooter variant="full" />
    </div>
  );
}
