import React from 'react';
import Link from 'next/link';
import { CookieInventoryTable } from '../_components/CookieInventoryTable';
import { COOKIE_NAME } from '../../utils/auth';

export default function PrivacyPage() {
  return (
    <div className="legal-container">
      <header className="legal-header">
        <Link href="/" className="back-link">
          ← Back to Home
        </Link>
        <div className="logo">
          📦 Assur<span>ly</span>
        </div>
      </header>

      <main className="legal-content">
        <h1>Privacy Policy</h1>
        <p className="last-updated">Last updated: June 27, 2026</p>

        <section className="legal-section">
          <h2>1. Introduction</h2>
          <p>
            Assurly (“we”, “our”, or “us”) provides a static code analysis tool designed to verify
            the production-readiness of B2B SaaS and Next.js projects. We are committed to
            protecting your privacy and security.
          </p>
          <p>
            This Privacy Policy explains how we collect, use, and safeguard your personal
            information when you use our website, web scanner, and command-line interface (CLI)
            tool. This policy is designed to meet the requirements of the General Data Protection
            Regulation (GDPR) and other global privacy frameworks.
          </p>
        </section>

        <section className="legal-section important-notice">
          <h2>🔒 2. How Source Code Is Processed</h2>
          <p>Where code is processed depends on the scanner you choose:</p>
          <ul>
            <li>
              <strong>Manual Web Checker:</strong> Pasted snippets, selected folders, and ZIP files
              are parsed and analyzed in your browser. Assurly does not upload their contents to its
              application server.
            </li>
            <li>
              <strong>Public GitHub Web Scan:</strong> Your browser requests repository trees and
              selected files through Assurly&apos;s server API. The server retrieves that content
              from GitHub and returns it to your browser for analysis. Source content therefore
              passes transiently through Assurly&apos;s server, but is not written to our database
              or retained as source files.
            </li>
            <li>
              <strong>Connected and Private GitHub Scans:</strong> Assurly&apos;s server retrieves
              repository content with a short-lived GitHub installation token. Webhook-triggered
              scans may analyze that content server-side. We store scan status, scores, file paths,
              and findings needed for scan history; we do not store complete repository source
              files.
            </li>
            <li>
              <strong>CLI Scanner:</strong> The CLI tool runs 100% locally on your machine or within
              your CI/CD runner. Your code is only handled by that environment unless the runner or
              workflow is configured to send it elsewhere.
            </li>
          </ul>
          <p>
            Do not intentionally submit live secrets. Although source files are not retained, code
            used by GitHub web integrations is transmitted over encrypted connections between your
            browser, Assurly, and GitHub as described above.
          </p>
        </section>

        <section className="legal-section">
          <h2>3. Information We Collect</h2>
          <p>
            We only collect the minimum amount of personal data necessary to provide and support our
            service:
          </p>
          <ul>
            <li>
              <strong>Contact &amp; Support Form:</strong> When you submit a request via our support
              form, we collect your <strong>Name</strong>, <strong>Email Address</strong>,{' '}
              <strong>Subject</strong>, and <strong>Message</strong>. This information is used
              solely to respond to your inquiry.
            </li>
            <li>
              <strong>Log Data:</strong> Our hosting providers (Vercel) may log standard connection
              details (IP address, user agent, timestamps) for performance and security diagnostics.
              Application logs may also contain request identifiers and operational metadata, but
              are not intended to contain repository source content.
            </li>
          </ul>
        </section>

        <section className="legal-section">
          <h2>4. Legal Basis for Processing (GDPR)</h2>
          <p>
            If you are located in the European Economic Area (EEA), we process your personal data
            under the following legal bases:
          </p>
          <ul>
            <li>
              <strong>Consent:</strong> When you explicitly submit your details via our contact
              form.
            </li>
            <li>
              <strong>Performance of a contract:</strong> When you sign in with GitHub, we process
              session data and set the strictly necessary <code>{COOKIE_NAME}</code> cookie so we
              can operate your dashboard, connected repository scans, and billing features you
              request.
            </li>
            <li>
              <strong>Legitimate Interests:</strong> To ensure the security, integrity, and
              performance of our website and services (for example, fraud prevention and secure
              OAuth).
            </li>
          </ul>
        </section>

        <section className="legal-section">
          <h2>5. Third-Party Data Processors</h2>
          <p>
            We utilize trusted third-party services to process data in compliance with GDPR. These
            service providers act as Data Processors:
          </p>
          <ul>
            <li>
              <strong>Authentication (Supabase):</strong> We use Supabase Auth to verify GitHub
              sign-in. Supabase processes account identifiers on our behalf under a Data Processing
              Agreement.
            </li>
            <li>
              <strong>Payments (Stripe):</strong> When you manage billing, your browser is
              redirected to Stripe-hosted pages. Stripe may set its own cookies on{' '}
              <code>stripe.com</code>; Assurly does not place Stripe tracking cookies on our domain.
            </li>
            <li>
              <strong>Email Delivery (Resend):</strong> We use Resend to deliver support requests
              submitted via the contact form. They process your name, email, and message body.
              Resend complies with standard contractual clauses and GDPR.
            </li>
            <li>
              <strong>Hosting (Vercel):</strong> We host our web application on Vercel, which
              processes server access logs necessary to deliver the service. We do not load Vercel
              Web Analytics or other optional analytics scripts in the application code.
            </li>
          </ul>
        </section>

        <section className="legal-section" id="cookies">
          <h2>6. Cookies and Similar Technologies</h2>
          <p>
            Under the EU ePrivacy rules and UK PECR, cookies that are not strictly necessary require
            your prior consent. Assurly&apos;s current web application sets{' '}
            <strong>only strictly necessary cookies</strong> required for sign-in, session
            management, and secure GitHub OAuth. We do not use advertising, marketing, retargeting,
            or product-analytics cookies (such as Google Analytics, Meta Pixel, PostHog, or Hotjar).
          </p>
          <p>
            Because we do not set optional cookie categories, we display an{' '}
            <strong>informational cookie notice</strong> for transparency — not a consent banner
            with Accept/Reject toggles. If we introduce optional cookies in the future, we will
            implement prior consent and update this policy before those technologies are enabled.
          </p>

          <h3>6.1 GitHub OAuth sign-in flow</h3>
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
              After approval, Assurly sets the <code>{COOKIE_NAME}</code> HttpOnly cookie with your
              Supabase session (and optional GitHub token for connected repository features).
            </li>
            <li>
              Legacy Supabase <code>sb-*-auth-token</code> cookies from older builds are cleared on
              login/logout so only <code>{COOKIE_NAME}</code> remains the session store.
            </li>
          </ol>

          <h3>6.2 Cookie inventory</h3>
          <CookieInventoryTable />

          <p>
            Additional technical detail for compliance reviews is maintained in our repository at{' '}
            <code>docs/legal/cookie-inventory.md</code>.
          </p>

          <h3>6.3 Managing cookies</h3>
          <p>
            You can delete cookies at any time through your browser settings. Clearing{' '}
            <code>{COOKIE_NAME}</code> will sign you out of the dashboard. Signing out via the app
            also expires session cookies server-side.
          </p>
        </section>

        <section className="legal-section">
          <h2>7. Your Rights Under GDPR</h2>
          <p>
            If you reside in the EEA or UK, you have the following rights regarding your personal
            data:
          </p>
          <ul>
            <li>
              <strong>Right of Access:</strong> You can request a copy of the support communications
              we hold.
            </li>
            <li>
              <strong>Right to Rectification:</strong> You can ask us to correct inaccurate email
              addresses or names.
            </li>
            <li>
              <strong>Right to Erasure (Right to be Forgotten):</strong> You can request that we
              delete all support emails and details.
            </li>
            <li>
              <strong>Right to Restriction:</strong> You can request that we temporarily suspend
              processing your support ticket.
            </li>
          </ul>
          <p>
            To exercise any of these rights, please contact us at{' '}
            <a href="mailto:support@assurly.dev">support@assurly.dev</a>.
          </p>
        </section>

        <section className="legal-section">
          <h2>8. Contact Us</h2>
          <p>For any questions about this Privacy Policy, please reach out to us at:</p>
          <p>
            Email: <a href="mailto:support@assurly.dev">support@assurly.dev</a>
          </p>
        </section>
      </main>
    </div>
  );
}
