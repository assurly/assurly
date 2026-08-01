import React from 'react';
import { StructuredData } from '../_components/StructuredData';
import { subPageGraph } from '../../utils/structuredData';
import Link from 'next/link';
import { AssurlyMark } from '../_components/AssurlyMark';
import { AssurlyWordmark } from '../_components/AssurlyWordmark';
import { SiteFooter } from '../_components/SiteFooter';
import { DISCLOSURE_CONTACT_PATH } from '../../utils/disclosureContact';

const TRUST_DESCRIPTION =
  'How Assurly keeps customer apps and data safe: security posture, data handling, subprocessors, and our coordinated vulnerability disclosure policy.';

export const metadata = {
  title: 'Trust & Security · Assurly',
  description:
    'How Assurly keeps customer apps and data safe: security posture, data handling, subprocessors, and our coordinated vulnerability disclosure policy.',
  // This is the page buyers read before connecting a private repository, and
  // sitemap.ts gives it the highest priority after / and /mcp. Inheriting the
  // root layout's `canonical: '/'` would fold it into the homepage instead.
  alternates: {
    canonical: '/trust',
  },
};

/**
 * Public trust page. Every claim here must be checkable against the code that
 * ships — this page is read by buyers deciding whether to connect a private
 * repository, so an aspirational statement is a liability, not marketing.
 *
 * It states how Assurly operates, never any customer's data, and it collects
 * nothing. Contact points mirror the Privacy Policy and Terms: a deep link into
 * the contact form with the subject preselected, so a vulnerability report is
 * never lost to a spam filter.
 *
 * Vulnerability intake must stay aligned with security.txt and the CRA runbook
 * via DISCLOSURE_CONTACT_PATH — see craContactConsistency.test.ts.
 */
const TRUST_CONTACT_HREF = DISCLOSURE_CONTACT_PATH;

export default function TrustPage() {
  return (
    <div className="legal-container">
      <StructuredData graph={subPageGraph('/trust', 'Trust & Security', TRUST_DESCRIPTION)} />
      <header className="legal-header">
        <Link href="/" className="back-link">
          ← Back to Home
        </Link>
        <div className="logo" role="img" aria-label="Assurly">
          <AssurlyMark className="site-logo-mark" />
          <AssurlyWordmark />
        </div>
      </header>

      <main className="legal-content">
        <h1>Trust &amp; Security</h1>
        <p className="last-updated">Last updated: July 24, 2026</p>

        <section className="legal-section">
          <h2>1. What this page is</h2>
          <p>
            Assurly is a pre-deploy ship gate: it tells you what will break in production before you
            deploy. Customers connect repositories and let us probe live applications, so they are
            entitled to know exactly how we operate.
          </p>
          <p>
            This page describes the controls that are actually implemented in the product today. It
            is a factual statement of our security posture, not a certification, an audit report, or
            a contractual warranty. Your contractual rights are in our{' '}
            <Link href="/terms">Terms of Service</Link>; how we handle personal data is in our{' '}
            <Link href="/privacy">Privacy Policy</Link>.
          </p>
        </section>

        <section className="legal-section important-notice">
          <h2>2. Certifications — what we do and do not hold</h2>
          <p>
            We would rather be precise than impressive. As of the date above,{' '}
            <strong>
              Assurly is not SOC 2 audited and does not hold ISO/IEC 27001 certification
            </strong>
            . We do not claim either, and you should treat any page that implies otherwise as wrong.
          </p>
          <p>
            We also do not operate a paid bug bounty, and the Free and Pro plans carry{' '}
            <strong>no contractual uptime commitment</strong>.
          </p>
          <p>
            What we do offer instead is verifiability: the controls below are specific enough that
            you can test most of them yourself against your own account, and our published scanner
            packages are open source under the MIT License, so the analysis logic is auditable.
          </p>
        </section>

        <section className="legal-section">
          <h2>3. Tenant isolation and access control</h2>
          <ul>
            <li>
              <strong>Isolation at the database boundary.</strong> Customer records are protected by
              PostgreSQL Row-Level Security scoped to the owning organization. A cross-tenant read
              is denied by the database itself, not only by application code — so an application bug
              alone does not expose another tenant.
            </li>
            <li>
              <strong>Least privilege.</strong> Request-time API-key authentication resolves only
              the caller&apos;s organization. The hosted verdict API is read-only and shape-only: it
              returns a verdict and score, never evidence rows, raw findings, or table names.
            </li>
            <li>
              <strong>API keys.</strong> Keys carry 192 bits of CSPRNG entropy and are stored as a
              SHA-256 hash. The plaintext is displayed once, at creation, and is never persisted or
              logged — we cannot recover a lost key, only replace it.
            </li>
            <li>
              <strong>Production access.</strong> Access to production systems is limited to the
              maintainers who need it, and the provider accounts behind the Service are protected by
              multi-factor authentication.
            </li>
          </ul>
        </section>

        <section className="legal-section important-notice">
          <h2>4. Active probing requires proven ownership</h2>
          <p>
            The active proof-of-exploit test — for example, checking whether a live database table
            is readable without access control — runs <strong>only</strong> against an application
            whose ownership the customer has proven. Ownership is established through a connected
            GitHub App installation, a DNS TXT record, a meta tag, or a hosted verification file.
          </p>
          <p>
            An unowned or unverified URL receives only safe, passive checks: response headers and
            secrets already exposed in a public JavaScript bundle.
          </p>

          <h3>4.1 Probes cannot change anything</h3>
          <p>
            Every probe is read-only. Mutating HTTP methods are rejected before a request is built,
            so a state-changing call against a customer application cannot be issued even if
            something upstream asked for one.
          </p>

          <h3>4.2 Every outbound request is SSRF-guarded</h3>
          <p>Requests to customer-supplied hosts go through a single hardened path that:</p>
          <ul>
            <li>rejects private, loopback, link-local, and otherwise non-public addresses;</li>
            <li>
              resolves DNS and <strong>pins the connection</strong> to the address it validated, so
              a DNS-rebinding attacker cannot return a public address for the check and a private
              one for the request;
            </li>
            <li>
              never auto-follows redirects — each hop is re-validated and re-pinned exactly like the
              original request, and the number of hops is bounded.
            </li>
          </ul>

          <h3>4.3 The plan is bounded before it runs</h3>
          <p>
            Probe plans are sanitised against a fixed allow-list of primitives with schema-validated
            parameters. Anything unrecognised is dropped rather than executed, and execution is
            capped by both step count and wall-clock duration. This rail is deterministic and does
            not depend on the AI layer being well-behaved.
          </p>
        </section>

        <section className="legal-section">
          <h2>5. Evidence handling and PII redaction</h2>
          <ul>
            <li>
              <strong>Proof is redacted at the source.</strong> When a probe demonstrates a risk, we
              record the <em>shape</em> of the exposure — for example &ldquo;500 rows; columns:
              email, password_hash; sample: <code>t***@***.com</code>&rdquo; — never full personal
              data. Redaction happens inside the scanner, before anything is stored or displayed.
            </li>
            <li>
              <strong>We prove scale without exfiltrating it.</strong> Row counts come from a
              count-only query, so we can state &ldquo;we could read N rows&rdquo; without
              retrieving them.
            </li>
            <li>
              <strong>Source code is not retained.</strong> The CLI runs entirely on your machine.
              Web and connected scans transmit content over encrypted connections and persist scan
              metadata and findings — file paths, line numbers, messages — not complete source
              files.
            </li>
            <li>
              <strong>The improvement corpus is aggregate-only.</strong> We learn from patterns: the
              AI-builder fingerprint, which rule fired, and whether a fix verified. It carries no
              finding messages, table names, organization identifiers, or per-customer rows, so it
              cannot surface a customer.
            </li>
            <li>
              <strong>Shared reports are your choice.</strong> A share link, public badge, or trust
              page is published only when you enable it, and stops being accessible when you revoke
              it.
            </li>
          </ul>
        </section>

        <section className="legal-section">
          <h2>6. Application security controls</h2>
          <ul>
            <li>
              <strong>Transport.</strong> All traffic is served over TLS, with HTTP Strict Transport
              Security set to two years, <code>includeSubDomains</code>, and preload.
            </li>
            <li>
              <strong>Response headers.</strong> <code>X-Frame-Options: DENY</code>,{' '}
              <code>X-Content-Type-Options: nosniff</code>, a strict <code>Referrer-Policy</code>,
              cross-origin opener and resource policies set to <code>same-origin</code>, and a{' '}
              <code>Permissions-Policy</code> denying camera, microphone, geolocation, and payment.
            </li>
            <li>
              <strong>Request hardening.</strong> State-changing routes require authentication, CSRF
              protection, a bounded request body, and schema validation of query, path, and body
              before any handler logic runs.
            </li>
            <li>
              <strong>Rate limiting.</strong> Per-caller limits protect the Service from abuse. The
              identifiers used are pseudonymised with a keyed hash before storage, so the stored
              value cannot be read back as an IP address or an account.
            </li>
            <li>
              <strong>Inbound webhooks.</strong> GitHub, Stripe, and deployment webhooks are
              signature-verified and processed idempotently through a unique-constraint ledger, so a
              replayed or forged delivery cannot double-apply.
            </li>
            <li>
              <strong>Sessions.</strong> The session cookie is HttpOnly and is expired server-side
              on sign-out. Legacy cookies from earlier builds are actively cleared.
            </li>
          </ul>
        </section>

        <section className="legal-section">
          <h2>7. How we build</h2>
          <p>
            Every change runs through a blocking CI pipeline before it can merge: the full automated
            test suite across all workspaces, ESLint, a production build of the CLI, GitHub Action,
            and web application, and Playwright responsive and accessibility checks.
          </p>
          <p>
            <strong>We run Assurly against Assurly on every commit.</strong> The dogfood gate is a
            required CI job — if our own scanner reports blockers in our own codebase above the
            configured threshold, the pipeline fails. We are subject to the product we sell.
          </p>
          <p>
            Third-party GitHub Actions are pinned to a full commit SHA rather than a moving tag, so
            a compromised or retagged action cannot silently enter our build.
          </p>
        </section>

        <section className="legal-section">
          <h2>8. AI safety</h2>
          <p>
            The AI reasoning layer is powered by Anthropic&apos;s Claude models and is{' '}
            <strong>optional and advisory</strong>. Three properties matter for your security:
          </p>
          <ul>
            <li>
              <strong>The gate never depends on AI.</strong> The deterministic scanner and the
              proof-of-exploit rails run independently. If the model is unavailable, degraded, or
              wrong, the verdict logic still holds.
            </li>
            <li>
              <strong>Scanned content is treated as untrusted.</strong> Content taken from a scanned
              application is wrapped as data, not instruction, so text planted in a repository or a
              page cannot redirect the model into acting on the attacker&apos;s behalf.
            </li>
            <li>
              <strong>Bounded context.</strong> We send the target origin, a technology fingerprint,
              the rule identifiers and messages our own scanner already produced, and an application
              context sample truncated to 3,000 characters — never your repository, complete source
              files, credentials, or account identity. Anthropic states that inputs and outputs from
              its commercial API are not used to train its models.
            </li>
          </ul>
          <p>
            Section 6 of our <Link href="/privacy">Privacy Policy</Link> sets this out in full.
          </p>
        </section>

        <section className="legal-section">
          <h2>9. Subprocessors</h2>
          <p>
            We rely on a small, deliberately short list of infrastructure providers. Each processes
            data on our documented instructions under a data processing agreement.
          </p>
          <div
            className="legal-table-wrap"
            role="region"
            aria-label="Infrastructure subprocessors"
            tabIndex={0}
          >
            <table className="legal-table">
              <thead>
                <tr>
                  <th>Provider</th>
                  <th>Function</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>Vercel</td>
                  <td>Application hosting and serverless compute</td>
                </tr>
                <tr>
                  <td>Supabase</td>
                  <td>Managed PostgreSQL, authentication, and Row-Level Security</td>
                </tr>
                <tr>
                  <td>GitHub</td>
                  <td>Sign-in and repository access you authorise</td>
                </tr>
                <tr>
                  <td>Stripe</td>
                  <td>Subscription billing — card data is handled on Stripe surfaces only</td>
                </tr>
                <tr>
                  <td>Anthropic</td>
                  <td>The optional AI reasoning layer</td>
                </tr>
                <tr>
                  <td>Resend</td>
                  <td>Transactional and alert email delivery</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p>
            We never store card data. If we add or replace a subprocessor in a way that materially
            affects the processing of your data, we will update this page and our Privacy Policy
            before the change takes effect.
          </p>
        </section>

        <section className="legal-section">
          <h2>10. Data location, retention, and deletion</h2>
          <p>
            Several of our providers are established in the United States, so data may be
            transferred outside the European Economic Area. Those transfers rely on the EU–U.S. Data
            Privacy Framework adequacy decision and/or the European Commission&apos;s Standard
            Contractual Clauses, supported by encryption in transit. Section 8 of our{' '}
            <Link href="/privacy">Privacy Policy</Link> covers this, and section 9 sets out how long
            each category of data is kept.
          </p>
          <p>
            You can delete scans and targets from the dashboard at any time. Deleting your account
            removes associated workspace records by cascading deletion, except records we are
            legally required to keep, such as invoices.
          </p>
        </section>

        <section className="legal-section">
          <h2>11. Availability and resilience</h2>
          <p>
            The Service runs on managed infrastructure with provider-level redundancy and managed
            database backups. We monitor for failures and treat a scan pipeline outage as a priority
            incident.
          </p>
          <p>
            To be clear about the limits: the Free and Pro plans carry{' '}
            <strong>no service level agreement</strong>, and we depend on GitHub, Vercel, Supabase,
            Stripe, and Anthropic remaining available. OEM and platform customers can agree service
            levels separately in writing.
          </p>
        </section>

        <section className="legal-section">
          <h2>12. Incident response</h2>
          <p>
            If we identify a security incident, we contain it first, then assess what data and which
            customers are affected, remediate, and record what we learned.
          </p>
          <p>
            Where a personal data breach is likely to result in a risk to the rights and freedoms of
            individuals, we notify the competent supervisory authority{' '}
            <strong>within 72 hours</strong> of becoming aware of it, as required by Article 33
            GDPR, and we inform affected individuals directly where the breach is likely to result
            in a high risk to them (Article 34).
          </p>
        </section>

        <section className="legal-section important-notice">
          <h2>13. Reporting a vulnerability</h2>
          <p>
            We welcome reports from security researchers and we will not take action against you for
            reporting in good faith. This is a coordinated vulnerability disclosure policy in the
            spirit of ISO/IEC 29147.
          </p>

          <h3>13.1 How to report</h3>
          <p>
            Send your report through{' '}
            <Link href={TRUST_CONTACT_HREF}>
              our contact form with the Trust &amp; Security subject
            </Link>{' '}
            preselected. Please include enough detail for us to reproduce the issue: the affected
            URL, endpoint, or package, the steps taken, and the impact you were able to demonstrate.
            Our disclosure contact is also published in machine-readable form at{' '}
            <code>/.well-known/security.txt</code> (RFC 9116). If you need an encrypted channel, say
            so in your first message and we will arrange one.
          </p>

          <h3>13.2 Safe harbour</h3>
          <p>
            If you make a good-faith effort to follow this policy while researching a vulnerability,
            we will consider your research <strong>authorised</strong>, we will work with you to
            understand and resolve the issue quickly, and{' '}
            <strong>we will not pursue or support legal action against you</strong>. If a third
            party brings action against you for activity conducted in compliance with this policy,
            we will make it known that your activity was authorised.
          </p>

          <h3>13.3 In scope</h3>
          <ul>
            <li>the Assurly web application, dashboard, and public API;</li>
            <li>
              our published packages: <code>assurly</code>, <code>@assurly/scanner-core</code>, and{' '}
              <code>@assurly/mcp-server</code>;
            </li>
            <li>the Assurly GitHub App and MCP server.</li>
          </ul>

          <h3>13.4 Out of scope</h3>
          <ul>
            <li>
              the infrastructure of our subprocessors — please report those to the provider
              directly;
            </li>
            <li>
              our customers&apos; own applications, including anything you learn about them through
              Assurly;
            </li>
            <li>
              denial of service, volumetric testing, physical attacks, and social engineering of our
              people or providers;
            </li>
            <li>
              raw automated-scanner output, or missing hardening headers, with no demonstrated
              security impact.
            </li>
          </ul>

          <h3>13.5 What we ask of you</h3>
          <ul>
            <li>
              Use only your own test accounts and data. Do not access, modify, or delete data
              belonging to anyone else.
            </li>
            <li>
              Stop as soon as you have demonstrated impact — proving a vulnerability exists never
              requires extracting real records.
            </li>
            <li>Do not degrade the Service for other users.</li>
            <li>
              Give us a reasonable opportunity to fix the issue before disclosing it publicly. Our
              default coordination window is 90 days, and we are happy to agree a different timeline
              where the circumstances justify it.
            </li>
          </ul>

          <h3>13.6 What you can expect from us</h3>
          <ul>
            <li>acknowledgement of your report within 5 business days;</li>
            <li>
              an initial assessment, including whether we accept the finding, within 10 business
              days;
            </li>
            <li>progress updates until the issue is resolved, and notice when the fix ships;</li>
            <li>credit for the discovery if you would like it.</li>
          </ul>
          <p>
            We do not operate a paid bug bounty and cannot offer monetary rewards. Regulation (EU)
            2024/2847 (the Cyber Resilience Act) introduces reporting obligations for actively
            exploited vulnerabilities from <strong>11 September 2026</strong>. Where those
            obligations apply to our published packages, we will report through the CRA Single
            Reporting Platform within the 24-hour early-warning and 72-hour notification windows it
            sets.
          </p>
        </section>

        <section className="legal-section">
          <h2>14. Responsible use of Assurly</h2>
          <p>
            Our safeguards do not replace your own authorisation. Scan and probe only what you own
            or what you are authorised in writing to test — even where ownership verification
            succeeds technically. Section 11 of our <Link href="/terms">Terms of Service</Link> sets
            out the rules you agree to when using the Service.
          </p>
        </section>

        <section className="legal-section">
          <h2>15. Contact</h2>
          <p>
            Security questions, vulnerability reports, subprocessor questions, and vendor security
            reviews all go through <Link href={TRUST_CONTACT_HREF}>our contact form</Link>, which
            opens with the <em>Trust &amp; Security</em> subject already selected.
          </p>
          <p>
            For privacy and data-subject requests, use the{' '}
            <Link href="/privacy">Privacy Policy</Link> contact route; for contractual questions,
            the <Link href="/terms">Terms of Service</Link> route.
          </p>
        </section>
      </main>
      <SiteFooter variant="full" />
    </div>
  );
}
