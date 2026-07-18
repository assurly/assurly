import React from 'react';
import Link from 'next/link';

export const metadata = {
  title: 'Trust & Security · Assurly',
  description:
    'How Assurly keeps customer apps and data safe: security posture, data handling, and subprocessors.',
};

/**
 * SOC2-lite trust page (Phase 8). Public, static security posture — it states how
 * Assurly operates, never any customer's data. It leans on the Phase 3 ownership
 * model and the Phase 2/5 PII redaction already shipped; it collects nothing new.
 */
export default function TrustPage() {
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
        <h1>Trust &amp; Security</h1>
        <p className="last-updated">Last updated: July 18, 2026</p>

        <section className="legal-section">
          <h2>1. Our security posture</h2>
          <p>
            Assurly is a proof-based ship gate for AI-built apps. We hold ourselves to the same bar
            we verify for our customers: least privilege, tenant isolation, no mutating actions
            against customer systems, and redaction of any sensitive data we surface as proof. The
            product passes its own scan.
          </p>
          <ul>
            <li>
              <strong>Tenant isolation:</strong> every customer record is protected by PostgreSQL
              Row-Level Security scoped to the owning organization. Cross-tenant reads are denied at
              the database boundary, not just in application code.
            </li>
            <li>
              <strong>Least-privilege access:</strong> request-time API-key authentication resolves
              only the caller&apos;s organization, and the hosted verdict API is read-only and
              shape-only — it never exposes evidence rows, raw findings, or table names.
            </li>
            <li>
              <strong>Secrets:</strong> programmatic API keys are stored as a SHA-256 hash of a
              192-bit random key; the plaintext is shown once and never persisted or logged.
            </li>
            <li>
              <strong>Transport:</strong> all traffic is served over TLS.
            </li>
          </ul>
        </section>

        <section className="legal-section important-notice">
          <h2>🔒 2. Active probing requires proven ownership</h2>
          <p>
            The active proof-of-exploit test (for example, checking whether a live database table is
            readable without access control) runs <strong>only</strong> against an app whose
            ownership the customer has proven — via a connected GitHub App, a DNS TXT record, a meta
            tag, or a hosted verification file. Unowned or unverified URLs receive only safe,
            passive checks (response headers, publicly exposed bundle secrets).
          </p>
          <p>
            All probes are strictly non-mutating and read-only. We never issue a state-changing HTTP
            method against a customer&apos;s app, and every outbound request to a customer-supplied
            host is routed through an SSRF-safe path that blocks internal and private addresses on
            every redirect hop.
          </p>
        </section>

        <section className="legal-section">
          <h2>3. Data handling &amp; PII redaction</h2>
          <ul>
            <li>
              <strong>Proof is redacted at the source.</strong> When a probe demonstrates a risk, we
              record the <em>shape</em> of the exposure (for example, &ldquo;500 rows; columns:
              email, password_hash; sample: <code>t***@***.com</code>&rdquo;) — never full personal
              data. Redaction happens inside the scanner before anything is stored or shown.
            </li>
            <li>
              <strong>We prove scale without exfiltration.</strong> Row counts are read via a
              count-only query, so we can say &ldquo;we could read N rows&rdquo; without retrieving
              them.
            </li>
            <li>
              <strong>Source code is not retained.</strong> The CLI runs fully locally. Web and
              connected scans transmit content over encrypted connections and persist scan metadata
              and findings, not complete source files.
            </li>
            <li>
              <strong>The improvement corpus is aggregate-only.</strong> We learn from patterns —
              the AI builder fingerprint, the rule that fired, and whether a fix verified — never
              from customer data, finding messages, table names, or per-customer rows.
            </li>
          </ul>
        </section>

        <section className="legal-section">
          <h2>4. Subprocessors</h2>
          <p>We rely on a small set of vetted infrastructure providers:</p>
          <ul>
            <li>
              <strong>Vercel</strong> — application hosting and serverless compute.
            </li>
            <li>
              <strong>Supabase</strong> — managed PostgreSQL, authentication, and Row-Level
              Security.
            </li>
            <li>
              <strong>Stripe</strong> — subscription billing (payment data is handled on
              Stripe-hosted surfaces; Assurly never stores card data).
            </li>
            <li>
              <strong>Resend</strong> — transactional and alert email delivery.
            </li>
            <li>
              <strong>Anthropic</strong> — the AI reasoning layer. Scanned content passed to the
              model is wrapped as untrusted data (prompt-injection defense), and the deterministic
              gate never depends on AI availability.
            </li>
          </ul>
        </section>

        <section className="legal-section">
          <h2>5. Consent &amp; your rights</h2>
          <p>
            We process the minimum data needed to run the service and set only strictly necessary
            cookies. Full detail on lawful bases, cookies, and your GDPR rights lives in our{' '}
            <Link href="/privacy">Privacy Policy</Link>, and the terms of use in our{' '}
            <Link href="/terms">Terms of Service</Link>.
          </p>
        </section>

        <section className="legal-section">
          <h2>6. Reporting a vulnerability</h2>
          <p>
            If you believe you have found a security issue in Assurly, please email{' '}
            <a href="mailto:security@assurly.dev">security@assurly.dev</a>. We investigate every
            report and will keep you updated on remediation.
          </p>
        </section>
      </main>
    </div>
  );
}
