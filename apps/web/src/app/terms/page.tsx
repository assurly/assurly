import React from 'react';
import Link from 'next/link';

export default function TermsPage() {
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
        <h1>Terms of Service</h1>
        <p className="last-updated">Last updated: June 13, 2026</p>

        <section className="legal-section">
          <h2>1. Agreement to Terms</h2>
          <p>
            By accessing or using the Assurly website, CLI scanner, or web-based sandbox checker,
            you agree to be bound by these Terms of Service (“Terms”). If you do not agree to these
            Terms, please do not use our services.
          </p>
        </section>

        <section className="legal-section">
          <h2>2. License and Permitted Use</h2>
          <p>
            We grant you a limited, revocable, non-exclusive, non-transferable license to use the
            Assurly static analyzer (CLI and Web interfaces) for personal, internal business, or
            educational evaluation of codebases.
          </p>
          <p>
            You are permitted to incorporate the CLI tool into your automated CI/CD pipeline runs
            (such as GitHub Actions) to run checks on your repositories.
          </p>
        </section>

        <section className="legal-section">
          <h2>3. Intellectual Property</h2>
          <p>
            All code, UI designs, brand assets, and algorithms contained in the Assurly repository
            and website are owned by Assurly and licensed under the MIT License unless otherwise
            specified.
          </p>
          <p>
            <strong>Your Code:</strong> You retain 100% ownership of any source code, migration
            scripts, or configurations you analyze. Manual web and CLI scans run locally. GitHub web
            integrations transmit repository content through Assurly&apos;s servers transiently as
            described in our Privacy Policy; complete source files are not retained.
          </p>
        </section>

        <section className="legal-section">
          <h2>4. Prohibited Conduct</h2>
          <p>You agree not to:</p>
          <ul>
            <li>
              Use the web scanner to scan repositories that you do not have permission or license to
              evaluate.
            </li>
            <li>Attempt to disrupt, disable, or hack the web application infrastructure.</li>
            <li>Scrape data or abuse the GitHub API Tree integration.</li>
            <li>
              Misrepresent the findings of the scanner for malicious, deceptive, or fraudulent
              purposes.
            </li>
          </ul>
        </section>

        <section className="legal-section important-notice">
          <h2>⚠️ 5. Disclaimer of Warranties (“As-Is”)</h2>
          <p>
            <strong>
              The software is provided on an “as-is” and “as-available” basis, without warranties of
              any kind.
            </strong>
          </p>
          <p>
            Static code analysis is a helper utility.{' '}
            <strong>It does not guarantee absolute security or production readiness.</strong> The
            scanner might:
          </p>
          <ul>
            <li>Fail to detect specific security bugs or integration flaws (false negatives).</li>
            <li>Flag valid, correct code structures as potential issues (false positives).</li>
          </ul>
          <p>
            You assume full responsibility for validating your configurations, verifying your code,
            testing Stripe integrations, and securing database connection pools before deploying to
            production.
          </p>
        </section>

        <section className="legal-section">
          <h2>6. Limitation of Liability</h2>
          <p>
            To the maximum extent permitted by applicable law, in no event shall Assurly or its
            maintainers be liable for any direct, indirect, incidental, special, consequential, or
            punitive damages, including but not limited to:
          </p>
          <ul>
            <li>Loss of profits, revenue, or business opportunities.</li>
            <li>Database connection pool exhaustion, crashes, or server outages.</li>
            <li>Financial losses from stripe webhook spoofing or unverified payments.</li>
            <li>Security leaks, data breaches, or exposed database secret keys.</li>
          </ul>
          <p>
            Your sole and exclusive remedy for dissatisfaction with the software is to stop using
            it.
          </p>
        </section>

        <section className="legal-section">
          <h2>7. Changes to Terms</h2>
          <p>
            We reserve the right, at our sole discretion, to modify or replace these Terms at any
            time. We will indicate changes by updating the “Last updated” date at the top of this
            page.
          </p>
        </section>

        <section className="legal-section">
          <h2>8. Contact</h2>
          <p>
            If you have any questions about these Terms of Service, please contact us at{' '}
            <a href="mailto:support@assurly.dev">support@assurly.dev</a>.
          </p>
        </section>
      </main>
    </div>
  );
}
