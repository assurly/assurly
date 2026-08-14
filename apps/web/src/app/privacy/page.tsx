import type { Metadata } from 'next';
import { StructuredData } from '../_components/StructuredData';
import { subPageGraph } from '../../utils/structuredData';
import { SITE_OG_IMAGE } from '../../utils/siteMetadata';
import React from 'react';
import Link from 'next/link';
import { AssurlyMark } from '../_components/AssurlyMark';
import { AssurlyWordmark } from '../_components/AssurlyWordmark';
import { CookieInventoryTable } from '../_components/CookieInventoryTable';
import { SiteFooter } from '../_components/SiteFooter';
import { COOKIE_NAME } from '../../utils/auth';
import { CONTACT_SUBJECT_PARAM } from '../../utils/contactSubjects';

/**
 * Deep link to the contact form with the privacy subject preselected. The query
 * parameter is resolved server-side in `app/page.tsx`; the hash scrolls the
 * visitor straight to the form.
 */
const PRIVACY_CONTACT_HREF = `/?${CONTACT_SUBJECT_PARAM}=privacy#contact`;

const PAGE_TITLE = 'Privacy Policy · Assurly';
const PAGE_DESCRIPTION =
  'How Assurly processes personal data as controller: what we collect, how source code is handled across scanners, cookies, subprocessors, retention, and your GDPR rights.';

export const metadata: Metadata = {
  title: PAGE_TITLE,
  description: PAGE_DESCRIPTION,
  openGraph: {
    title: PAGE_TITLE,
    description: PAGE_DESCRIPTION,
    type: 'website',
    url: '/privacy',
    images: [SITE_OG_IMAGE],
  },
  twitter: {
    card: 'summary_large_image',
    title: PAGE_TITLE,
    description: PAGE_DESCRIPTION,
  },
  // Without this the page inherits `canonical: '/'` from the root layout and
  // tells search engines it is a duplicate of the homepage — while sitemap.ts
  // lists it as indexable. The canonical wins, so the sitemap entry is ignored.
  alternates: {
    canonical: '/privacy',
  },
};

export default function PrivacyPage() {
  return (
    <div className="legal-container">
      <StructuredData graph={subPageGraph('/privacy', 'Privacy Policy', PAGE_DESCRIPTION)} />
      <header className="legal-header">
        <Link href="/" className="back-link">
          ← Back to Home
        </Link>
        <div className="logo" role="img" aria-label="Assurly">
          <AssurlyMark className="site-logo-mark" />
          <AssurlyWordmark accentClassName="site-logo-accent" />
        </div>
      </header>

      <main className="legal-content">
        <h1>Privacy Policy</h1>
        <p className="last-updated">Last updated: July 24, 2026</p>

        <section className="legal-section">
          <h2>1. Who we are and how to reach us</h2>
          <p>
            Assurly is a pre-deploy security scanner for web applications. It is offered as a hosted
            web application and dashboard, a command-line scanner, an MCP server, and a GitHub
            integration.
          </p>
          <p>
            For the purposes of the EU General Data Protection Regulation (GDPR), the{' '}
            <strong>data controller</strong> for the personal data described in this policy is:
          </p>
          <ul>
            <li>
              <strong>Tibor Kútik</strong>
            </li>
            <li>
              <strong>Address:</strong> Hlavná 454, 941 33 Kolta, Slovak Republic
            </li>
            <li>
              <strong>VAT identification number:</strong> not registered for VAT
            </li>
            <li>
              <strong>Contact:</strong> <Link href={PRIVACY_CONTACT_HREF}>our contact form</Link>{' '}
              (select <em>Privacy / Data Protection</em>)
            </li>
          </ul>
          <p>
            We have not appointed a Data Protection Officer, as we are not required to do so under
            Article 37 GDPR. Privacy enquiries are handled directly at the address above.
          </p>
        </section>

        <section className="legal-section important-notice">
          <h2>2. The short version</h2>
          <ul>
            <li>
              We do <strong>not</strong> sell your personal data, and we do not use it for
              advertising or behavioural profiling.
            </li>
            <li>
              We set <strong>only strictly necessary cookies</strong>. No analytics, advertising, or
              tracking cookies.
            </li>
            <li>
              We do <strong>not retain complete copies of your source code</strong>. Scan results
              store findings and file paths, not whole files.
            </li>
            <li>
              Our optional AI features send <strong>limited context</strong> — never your full
              repository — to Anthropic. See section 6.
            </li>
            <li>
              Our AI provider does <strong>not train models</strong> on data we send through its
              commercial API.
            </li>
          </ul>
        </section>

        <section className="legal-section important-notice">
          <h2>3. How your source code is processed</h2>
          <p>Where your code is processed depends on which scanner you use:</p>
          <ul>
            <li>
              <strong>CLI scanner:</strong> runs entirely on your machine or inside your own CI/CD
              runner. Your code never reaches our servers.
            </li>
            <li>
              <strong>Manual web checker:</strong> pasted snippets, selected folders, and ZIP files
              are parsed and analysed in your browser. Their contents are not uploaded to our
              application server.
            </li>
            <li>
              <strong>Public GitHub web scan:</strong> your browser requests repository trees and
              selected files through our server API. Our server retrieves that content from GitHub
              and returns it to your browser for analysis. Source content therefore passes
              transiently through Assurly&apos;s servers, but is not written to our database.
            </li>
            <li>
              <strong>Connected and private GitHub scans:</strong> our server retrieves repository
              content using a short-lived GitHub App installation token. Webhook-triggered scans
              analyse that content server-side. We store scan metadata and findings — including{' '}
              <strong>file paths, line numbers, and finding messages</strong> — but we do not store
              complete repository source files.
            </li>
            <li>
              <strong>Live URL probes:</strong> where you have verified ownership of a target URL,
              we make requests to that URL and record redacted evidence of what a finding was based
              on. We store a summary and a redacted sample, not full responses.
            </li>
          </ul>
          <p>
            <strong>
              Please do not deliberately submit live secrets or production credentials.
            </strong>{' '}
            Although complete source files are not retained, content handled by our GitHub
            integrations is transmitted over encrypted connections between your browser, our
            servers, and GitHub as described above.
          </p>
        </section>

        <section className="legal-section">
          <h2>4. Personal data we collect</h2>

          <h3>4.1 Account and identity data</h3>
          <p>
            When you sign in with GitHub, our authentication provider supplies us with your{' '}
            <strong>user identifier</strong>, <strong>email address</strong>,{' '}
            <strong>display name</strong>, and <strong>avatar URL</strong>. We store your workspace
            membership and role (administrator or member).
          </p>

          <h3>4.2 Workspace and billing data</h3>
          <p>
            We store your workspace name, billing plan, GitHub organisation and installation
            identifiers, and — if you subscribe — the Stripe customer, subscription, and price
            identifiers together with billing event records. We never receive or store your full
            card number; card data is handled exclusively by Stripe.
          </p>

          <h3>4.3 Scanning and product data</h3>
          <p>These records relate to the projects you ask us to check:</p>
          <ul>
            <li>
              <strong>Guarded targets:</strong> repository names, application URLs, display names, a
              technology fingerprint, ownership-verification status and method, current verdict and
              Ship Score.
            </li>
            <li>
              <strong>Scans:</strong> commit SHA, branch, status, and error/warning counts.
            </li>
            <li>
              <strong>Findings:</strong> rule identifier, severity, confidence,{' '}
              <strong>file path</strong>, line number, message, and remediation suggestion.
            </li>
            <li>
              <strong>Probe evidence:</strong> a summary and a redacted sample supporting a finding.
            </li>
            <li>
              <strong>Fix outcomes:</strong> rule identifier, fix strategy, outcome, pull-request
              URL, and deployment identifier.
            </li>
            <li>
              <strong>Alert preferences:</strong> the channel you choose and, where applicable, the
              webhook URL you supply.
            </li>
            <li>
              <strong>Shared reports:</strong> if you generate a share link, the report becomes
              accessible to anyone holding that link until you revoke it.
            </li>
          </ul>

          <h3>4.4 API keys</h3>
          <p>
            We store a label you choose, a short non-secret display prefix, an irreversible SHA-256
            hash of the key, the plan tier, and the time the key was last used.{' '}
            <strong>The plaintext key is never stored</strong> — it is shown to you once at
            creation.
          </p>

          <h3>4.5 Technical and security data</h3>
          <ul>
            <li>
              <strong>Server logs:</strong> our hosting provider records connection details such as
              IP address, user agent, and timestamps. Our application logs contain request
              identifiers and operational metadata, and are not intended to contain repository
              source content.
            </li>
            <li>
              <strong>Rate limiting:</strong> to protect the service from abuse we apply per-caller
              limits. Identifiers used for this purpose are{' '}
              <strong>pseudonymised with a keyed hash</strong> before storage, so the stored value
              cannot be read back as an IP address or account identifier.
            </li>
            <li>
              <strong>Webhook deliveries:</strong> delivery identifiers, event types, installation
              identifiers, processing status, and any error message, retained to prevent duplicate
              processing.
            </li>
          </ul>

          <h3>4.6 Support correspondence</h3>
          <p>
            If you contact us through the support form, we collect your <strong>name</strong>,{' '}
            <strong>email address</strong>, <strong>subject</strong>, and <strong>message</strong>,
            and use them solely to answer you.
          </p>
        </section>

        <section className="legal-section">
          <h2>5. Purposes and legal bases (Article 6 GDPR)</h2>
          <div
            className="legal-table-wrap"
            role="region"
            aria-label="Purposes and legal bases for processing"
            tabIndex={0}
          >
            <table className="legal-table">
              <thead>
                <tr>
                  <th>Purpose</th>
                  <th>Data</th>
                  <th>Legal basis</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>Creating your account and operating the dashboard</td>
                  <td>Identity, workspace, membership</td>
                  <td>Performance of a contract — Art. 6(1)(b)</td>
                </tr>
                <tr>
                  <td>Running scans, probes, and producing verdicts</td>
                  <td>Targets, scans, findings, evidence</td>
                  <td>Performance of a contract — Art. 6(1)(b)</td>
                </tr>
                <tr>
                  <td>Taking payment and managing subscriptions</td>
                  <td>Billing identifiers, plan, billing events</td>
                  <td>Performance of a contract — Art. 6(1)(b)</td>
                </tr>
                <tr>
                  <td>Sending service and alert notifications you enable</td>
                  <td>Email address, alert preferences</td>
                  <td>Performance of a contract — Art. 6(1)(b)</td>
                </tr>
                <tr>
                  <td>Optional AI deep review</td>
                  <td>Target URL, findings, limited app context</td>
                  <td>Performance of a contract — Art. 6(1)(b)</td>
                </tr>
                <tr>
                  <td>Answering support requests</td>
                  <td>Name, email, message</td>
                  <td>Consent — Art. 6(1)(a)</td>
                </tr>
                <tr>
                  <td>Security, abuse prevention, and rate limiting</td>
                  <td>Pseudonymised caller identifiers, logs</td>
                  <td>Legitimate interests — Art. 6(1)(f)</td>
                </tr>
                <tr>
                  <td>Meeting accounting and tax obligations</td>
                  <td>Invoice and transaction records</td>
                  <td>Legal obligation — Art. 6(1)(c)</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p>
            Where we rely on legitimate interests, our interest is keeping the service available,
            secure, and free from abuse. We have considered your rights and freedoms and use
            pseudonymisation to reduce the impact on you. You may object at any time — see section
            11.
          </p>
        </section>

        <section className="legal-section important-notice">
          <h2>6. Artificial intelligence features</h2>
          <p>
            Assurly includes optional AI-assisted features: a deep review layer that reasons about
            scan findings, and generated remediation prompts. These are powered by{' '}
            <strong>
              Anthropic&apos;s Claude models, accessed through Anthropic&apos;s commercial API
            </strong>
            . You are interacting with an AI system when you use these features.
          </p>

          <h3>6.1 What we send</h3>
          <p>When an AI feature runs, we send Anthropic a bounded context consisting of:</p>
          <ul>
            <li>the target application&apos;s origin (its URL);</li>
            <li>a technology fingerprint and framework hints;</li>
            <li>
              the rule identifiers and messages of findings already produced by our own non-AI
              scanner; and
            </li>
            <li>
              a truncated application context sample, limited to a maximum of{' '}
              <strong>3,000 characters</strong>.
            </li>
          </ul>
          <p>
            We do <strong>not</strong> send your repository, complete source files, credentials, or
            your account identity.
          </p>

          <h3>6.2 How that data is handled</h3>
          <p>
            Anthropic states that, by default, inputs and outputs from its commercial API are{' '}
            <strong>not used to train its models</strong>. Anthropic processes this data as our
            sub-processor.
          </p>

          <h3>6.3 No automated decisions with legal effect</h3>
          <p>
            AI output is advisory. It annotates and explains findings; it does not make decisions
            producing legal or similarly significant effects concerning you within the meaning of
            Article 22 GDPR. A verdict is a recommendation about software, not about a person.
          </p>

          <h3>6.4 Accuracy</h3>
          <p>
            AI-generated explanations can be incomplete or wrong. They do not guarantee security or
            production readiness, and you remain responsible for verifying your own configuration
            before deploying.
          </p>
        </section>

        <section className="legal-section">
          <h2>7. Sub-processors and recipients</h2>
          <p>
            We use the following processors. Each acts on our documented instructions under a data
            processing agreement.
          </p>
          <div
            className="legal-table-wrap"
            role="region"
            aria-label="Sub-processors and data recipients"
            tabIndex={0}
          >
            <table className="legal-table">
              <thead>
                <tr>
                  <th>Provider</th>
                  <th>Function</th>
                  <th>Data involved</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>Supabase</td>
                  <td>Authentication and database hosting</td>
                  <td>Account identity, workspace, scan and billing records</td>
                </tr>
                <tr>
                  <td>Vercel</td>
                  <td>Application hosting and delivery</td>
                  <td>Server access logs, request metadata</td>
                </tr>
                <tr>
                  <td>Stripe</td>
                  <td>Payment processing and billing portal</td>
                  <td>Billing identifiers, payment details you enter on Stripe pages</td>
                </tr>
                <tr>
                  <td>Anthropic</td>
                  <td>AI deep review and remediation prompts</td>
                  <td>Target URL, findings, limited app context (see section 6)</td>
                </tr>
                <tr>
                  <td>Resend</td>
                  <td>Transactional and support email delivery</td>
                  <td>Name, email address, message content</td>
                </tr>
                <tr>
                  <td>GitHub</td>
                  <td>Sign-in and repository access</td>
                  <td>Account identity, repository content you authorise</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p>
            We may also disclose personal data where we are legally required to do so, or to
            establish, exercise, or defend legal claims. We do not sell personal data.
          </p>
        </section>

        <section className="legal-section">
          <h2>8. International transfers</h2>
          <p>
            Several of our processors are established in the United States, so your personal data
            may be transferred outside the European Economic Area. Where that happens, we rely on
            one or more of the safeguards permitted by Chapter V GDPR:
          </p>
          <ul>
            <li>
              the European Commission&apos;s <strong>adequacy decision</strong> for the EU–U.S. Data
              Privacy Framework, where the recipient is certified under it; and/or
            </li>
            <li>
              the European Commission&apos;s <strong>Standard Contractual Clauses</strong>{' '}
              (Implementing Decision (EU) 2021/914), supported by additional technical measures such
              as encryption in transit.
            </li>
          </ul>
          <p>
            You may request a copy of the safeguards applied to a specific transfer by contacting
            us.
          </p>
        </section>

        <section className="legal-section">
          <h2>9. How long we keep data</h2>
          <div
            className="legal-table-wrap"
            role="region"
            aria-label="Data retention by category"
            tabIndex={0}
          >
            <table className="legal-table">
              <thead>
                <tr>
                  <th>Category</th>
                  <th>Retention</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>Account, workspace, and membership records</td>
                  <td>For as long as your account exists</td>
                </tr>
                <tr>
                  <td>Scans, findings, probe evidence, and fix outcomes</td>
                  <td>Deleted when you delete the scan or target, or with your account</td>
                </tr>
                <tr>
                  <td>API keys</td>
                  <td>Until you revoke or delete them</td>
                </tr>
                <tr>
                  <td>Rate-limiting records</td>
                  <td>Short-lived; expire automatically after their window</td>
                </tr>
                <tr>
                  <td>Webhook delivery records</td>
                  <td>Retained only as long as needed to prevent duplicate processing</td>
                </tr>
                <tr>
                  <td>Support correspondence</td>
                  <td>Up to 24 months after the enquiry is resolved</td>
                </tr>
                <tr>
                  <td>Invoices and accounting records</td>
                  <td>As required by applicable tax law (typically 10 years)</td>
                </tr>
                <tr>
                  <td>Server logs</td>
                  <td>Per our hosting provider&apos;s standard retention period</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p>
            When you delete your account, associated workspace records are removed by cascading
            deletion. Records we must keep for legal reasons, such as invoices, are retained for the
            statutory period and then deleted.
          </p>
        </section>

        <section className="legal-section" id="cookies">
          <h2>10. Cookies and similar technologies</h2>
          <p>
            Under the EU ePrivacy rules and UK PECR, cookies that are not strictly necessary require
            your prior consent. Assurly sets <strong>only strictly necessary cookies</strong>{' '}
            required for sign-in, session management, and secure GitHub OAuth. We do not use
            advertising, marketing, retargeting, or product-analytics cookies (such as Google
            Analytics, Meta Pixel, PostHog, or Hotjar).
          </p>
          <p>
            Because we set no optional cookie categories, we display an{' '}
            <strong>informational cookie notice</strong> rather than a consent banner with
            accept/reject toggles. If we introduce optional cookies in the future, we will implement
            prior consent and update this policy before those technologies are enabled.
          </p>

          <h3>10.1 GitHub OAuth sign-in flow</h3>
          <p>When you choose &quot;Sign in with GitHub&quot;:</p>
          <ol>
            <li>
              Assurly sets a short-lived PKCE verifier cookie (
              <code>sb-*-auth-token-code-verifier</code>) to secure the OAuth exchange.
            </li>
            <li>
              You are redirected to GitHub, which may set its own cookies on <code>github.com</code>{' '}
              under GitHub&apos;s privacy policy.
            </li>
            <li>
              After approval, Assurly sets the <code>{COOKIE_NAME}</code> HttpOnly cookie holding
              your session (and, for connected repository features, a GitHub token).
            </li>
            <li>
              Legacy Supabase <code>sb-*-auth-token</code> cookies from older builds are cleared on
              login and logout so that <code>{COOKIE_NAME}</code> remains the only session store.
            </li>
          </ol>

          <h3>10.2 Cookie inventory</h3>
          <CookieInventoryTable />

          <h3>10.3 Managing cookies</h3>
          <p>
            You can delete cookies at any time through your browser settings. Clearing{' '}
            <code>{COOKIE_NAME}</code> will sign you out of the dashboard. Signing out in the app
            also expires session cookies server-side.
          </p>
        </section>

        <section className="legal-section">
          <h2>11. Your rights</h2>
          <p>
            If you are in the European Economic Area or the United Kingdom, you have the following
            rights in relation to your personal data:
          </p>
          <ul>
            <li>
              <strong>Access</strong> (Art. 15) — obtain confirmation of whether we process your
              data and receive a copy of it.
            </li>
            <li>
              <strong>Rectification</strong> (Art. 16) — have inaccurate data corrected and
              incomplete data completed.
            </li>
            <li>
              <strong>Erasure</strong> (Art. 17) — have your data deleted where one of the grounds
              in the GDPR applies.
            </li>
            <li>
              <strong>Restriction</strong> (Art. 18) — have processing limited in certain
              circumstances.
            </li>
            <li>
              <strong>Data portability</strong> (Art. 20) — receive data you provided to us in a
              structured, commonly used, machine-readable format, and have it transmitted to another
              controller where technically feasible.
            </li>
            <li>
              <strong>Objection</strong> (Art. 21) — object at any time to processing based on our
              legitimate interests.
            </li>
            <li>
              <strong>Withdraw consent</strong> (Art. 7(3)) — where we rely on consent, withdraw it
              at any time. This does not affect the lawfulness of processing carried out before
              withdrawal.
            </li>
          </ul>
          <p>
            To exercise any of these rights, submit a request through{' '}
            <Link href={PRIVACY_CONTACT_HREF}>our contact form</Link> — the{' '}
            <em>Privacy / Data Protection</em> subject is preselected for you. We respond within one
            month, which may be extended by two further months for complex requests, in which case
            we will tell you.
          </p>

          <h3>11.1 Right to lodge a complaint</h3>
          <p>
            You have the right to lodge a complaint with a supervisory authority, in particular in
            the Member State of your habitual residence, place of work, or the place of the alleged
            infringement (Art. 77 GDPR). Our lead supervisory authority is:
          </p>
          <ul>
            <li>
              <strong>Úrad na ochranu osobných údajov Slovenskej republiky</strong>
              <br />
              Hraničná 12, 820 07 Bratislava 27, Slovakia
              <br />
              <a href="https://dataprotection.gov.sk" target="_blank" rel="noopener noreferrer">
                dataprotection.gov.sk
              </a>
            </li>
          </ul>
          <p>
            If you are in the United Kingdom, you may instead complain to the Information
            Commissioner&apos;s Office (ico.org.uk).
          </p>
        </section>

        <section className="legal-section">
          <h2>12. Security</h2>
          <p>
            We apply technical and organisational measures appropriate to the risk, including
            encryption in transit, row-level security isolating each workspace&apos;s data,
            irreversible hashing of API keys, pseudonymisation of rate-limiting identifiers,
            signature verification on inbound webhooks, and least-privilege access to production
            systems. No system is perfectly secure, and we cannot guarantee absolute security.
          </p>
          <p>
            If we become aware of a personal data breach likely to result in a risk to your rights
            and freedoms, we will notify the competent supervisory authority within 72 hours where
            required, and inform you where the breach is likely to result in a high risk to you.
          </p>
        </section>

        <section className="legal-section">
          <h2>13. Children</h2>
          <p>
            Assurly is a professional developer tool and is not directed at children. We do not
            knowingly collect personal data from anyone under 16. If you believe a child has
            provided us with personal data, contact us and we will delete it.
          </p>
        </section>

        <section className="legal-section">
          <h2>14. Changes to this policy</h2>
          <p>
            We may update this policy to reflect changes to the service or the law. We will update
            the &quot;Last updated&quot; date above, and for material changes affecting your rights
            we will provide additional notice in the application or by email before the change takes
            effect.
          </p>
        </section>

        <section className="legal-section">
          <h2>15. Contact</h2>
          <p>
            All privacy enquiries and data-subject requests go through{' '}
            <Link href={PRIVACY_CONTACT_HREF}>our contact form</Link>, which opens with the{' '}
            <em>Privacy / Data Protection</em> subject already selected. Using the form means your
            request reaches us with the right category and is not lost to a spam filter.
          </p>
        </section>
      </main>
      <SiteFooter variant="full" />
    </div>
  );
}
