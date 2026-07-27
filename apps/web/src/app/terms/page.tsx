import React from 'react';
import Link from 'next/link';
import { AssurlyMark } from '../_components/AssurlyMark';
import { SiteFooter } from '../_components/SiteFooter';
import { CONTACT_SUBJECT_PARAM } from '../../utils/contactSubjects';

/**
 * Deep link to the contact form with the Terms subject preselected. The query
 * parameter is resolved server-side in `app/page.tsx`; the hash scrolls the
 * visitor straight to the form. Mirrors PRIVACY_CONTACT_HREF on the policy page
 * so every legal contact point on the site behaves identically.
 */
const TERMS_CONTACT_HREF = `/?${CONTACT_SUBJECT_PARAM}=terms#contact`;

export default function TermsPage() {
  return (
    <div className="legal-container">
      <header className="legal-header">
        <Link href="/" className="back-link">
          ← Back to Home
        </Link>
        <div className="logo">
          <AssurlyMark className="site-logo-mark" />
          Ass<span>url</span>y
        </div>
      </header>

      <main className="legal-content">
        <h1>Terms of Service</h1>
        <p className="last-updated">Last updated: July 24, 2026</p>

        <section className="legal-section">
          <h2>1. These Terms and who you are contracting with</h2>
          <p>
            These Terms of Service (&quot;<strong>Terms</strong>&quot;) form a binding agreement
            between you and the provider identified below (&quot;<strong>Assurly</strong>&quot;,
            &quot;we&quot;, &quot;us&quot;, &quot;our&quot;). They govern your use of the Assurly
            website, hosted dashboard, command-line scanner, MCP server, GitHub integration, public
            badge and trust pages, and verdict API (together, the &quot;<strong>Service</strong>
            &quot;).
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
              <strong>Contact:</strong> <Link href={TERMS_CONTACT_HREF}>our contact form</Link>{' '}
              (select <em>Terms of Service</em>)
            </li>
          </ul>
          <p>
            By creating an account, installing the CLI or the GitHub App, calling our API, or
            otherwise using the Service, you accept these Terms. If you do not accept them, do not
            use the Service.
          </p>
          <p>
            If you use the Service on behalf of a company or other organisation, you confirm that
            you are authorised to bind that organisation, and &quot;you&quot; means that
            organisation.
          </p>

          <h3>1.1 Consumers and business customers</h3>
          <p>
            A <strong>consumer</strong> is a natural person acting wholly or mainly outside their
            trade, business, craft, or profession. Everyone else is a{' '}
            <strong>business customer</strong>. Some sections below apply only to one group and say
            so. Nothing in these Terms limits or excludes mandatory rights you have as a consumer
            under the law of your country of residence.
          </p>

          <h3>1.2 Documents that form part of this agreement</h3>
          <p>
            Our <Link href="/privacy">Privacy Policy</Link> explains how we process personal data
            and forms part of these Terms. If you are an OEM or platform customer with a signed
            order form or separate agreement, that document prevails over these Terms where the two
            conflict.
          </p>
        </section>

        <section className="legal-section">
          <h2>2. Eligibility, accounts, and API keys</h2>
          <p>
            You must be at least 18 years old to enter into these Terms and to purchase a paid plan.
            Assurly is a professional developer tool and is not directed at children.
          </p>
          <p>
            You sign in with GitHub. You are responsible for keeping your GitHub account secure, for
            everything done under your Assurly account, and for the acts and omissions of the
            members you add to your workspace. Tell us promptly if you believe your account or a
            workspace has been accessed without authorisation.
          </p>
          <p>
            <strong>API keys</strong> are shown to you once, at creation. We store only an
            irreversible hash of the key, never the key itself, so we cannot recover it for you. You
            are responsible for keeping keys secret and for all usage made with them. Revoke a key
            immediately if you suspect it has been exposed.
          </p>
        </section>

        <section className="legal-section">
          <h2>3. What the Service does</h2>
          <p>Assurly checks an application before you deploy it. It runs in several ways:</p>
          <ul>
            <li>
              <strong>CLI scanner:</strong> runs entirely on your machine or in your own CI/CD
              runner.
            </li>
            <li>
              <strong>Manual web checker:</strong> pasted snippets, selected folders, and ZIP files
              are analysed in your browser.
            </li>
            <li>
              <strong>GitHub scans:</strong> public, connected, and webhook-triggered scans of
              repositories you authorise.
            </li>
            <li>
              <strong>Live URL probes:</strong> requests made to a target URL whose ownership you
              have verified through the Service.
            </li>
            <li>
              <strong>MCP server and verdict API:</strong> programmatic access to scans and verdicts
              for your own tooling and AI agents.
            </li>
          </ul>
          <p>
            Our GitHub web integrations transmit repository content through Assurly&apos;s servers
            transiently, as described in our <Link href="/privacy">Privacy Policy</Link>. We store
            scan metadata and findings — including file paths, line numbers, and messages — but we
            do not retain complete repository source files.
          </p>
          <p>
            A scan produces findings, a verdict, and a Ship Score. Depending on your plan it may
            also produce AI-assisted explanations, proposed fix pull requests, regression alerts, a
            public badge, and a trust page.
          </p>
        </section>

        <section className="legal-section important-notice">
          <h2>4. What Assurly is not</h2>
          <p>
            Read this section carefully. It describes the limits of what the Service can do, and
            those limits shape the disclaimers in sections 16 and 17.
          </p>
          <ul>
            <li>
              Assurly is a <strong>helper utility</strong>. It is not a penetration test, a security
              audit, a compliance certification, or an assurance that your application is secure.
            </li>
            <li>
              Static analysis and automated probing produce <strong>false negatives</strong> — real
              problems the scanner does not detect — and <strong>false positives</strong> — correct
              code flagged as a problem.
            </li>
            <li>
              A &quot;ship&quot; verdict or a high Ship Score is a{' '}
              <strong>recommendation about software at a point in time</strong>, based on what we
              could observe. It is not a warranty, a guarantee, or professional advice.
            </li>
            <li>
              AI-generated explanations and fixes are <strong>advisory</strong> and can be
              incomplete or wrong. Review every proposed change before merging it.
            </li>
            <li>
              We do not provide legal, regulatory, or professional security advice. Nothing in the
              Service is a substitute for your own judgement or, where you need it, qualified
              professional advice.
            </li>
          </ul>
          <p>
            <strong>
              You remain responsible for verifying your configuration, testing your payment
              integrations, securing your database and secrets, and for the decision to deploy.
            </strong>
          </p>
        </section>

        <section className="legal-section">
          <h2>5. Plans</h2>
          <div className="legal-table-wrap">
            <table className="legal-table">
              <thead>
                <tr>
                  <th>Plan</th>
                  <th>Price</th>
                  <th>Includes</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>Free</td>
                  <td>€0</td>
                  <td>
                    Live proof-probe, one guarded app, MCP server access, unlimited local CLI scans,
                    community support
                  </td>
                </tr>
                <tr>
                  <td>Pro</td>
                  <td>€17 / month or €130 / year</td>
                  <td>
                    Unlimited guarded apps, continuous Guardian on every deploy, AI deep review,
                    verified badge and trust page, auto-fix pull requests, private repository
                    scanning
                  </td>
                </tr>
                <tr>
                  <td>OEM / Platform</td>
                  <td>Custom</td>
                  <td>
                    Everything in Pro, keyed verdict API, MCP ship-gate, white-label widget, higher
                    programmatic limits, priority support
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <p>
            Prices are also shown in US dollars ($19 / month, $149 / year). The currency and amount
            you will be charged are displayed before you confirm. OEM and platform access is agreed
            separately and is not purchasable from the pricing page.
          </p>
          <p>
            Plan features may change as the Service develops; section 14 explains how we handle
            changes.
          </p>
        </section>

        <section className="legal-section">
          <h2>6. Fees, free trial, billing, and renewal</h2>

          <h3>6.1 The price you pay</h3>
          <p>
            The amount displayed at checkout is the total amount payable for the billing period. Any
            tax we are required to charge is shown separately before you confirm. Payments are
            processed by Stripe; we never receive or store your full card number.
          </p>

          <h3>6.2 Free trial</h3>
          <p>
            Pro includes a <strong>7-day free trial</strong>. You provide a payment method at
            checkout, but no payment is taken during the trial. Unless you cancel before the trial
            ends, the subscription <strong>converts automatically</strong> into a paid subscription
            and we charge the plan price to your payment method. One trial per customer. We may
            withdraw or shorten a trial where it is being abused.
          </p>

          <h3>6.3 Automatic renewal</h3>
          <p>
            Paid subscriptions <strong>renew automatically</strong> at the end of each billing
            period — monthly or annual, matching the plan you chose — for a further period of the
            same length, at the then-current price for your plan, until you cancel. We charge the
            payment method on file on each renewal date. You can cancel at any time under section 7.
          </p>

          <h3>6.4 Price changes</h3>
          <p>
            We may change our prices. If a change affects your existing subscription, we will notify
            you by email at least <strong>30 days</strong> before it takes effect. The new price
            applies from your next renewal, never to a period you have already paid for, and you may
            cancel before it takes effect.
          </p>

          <h3>6.5 Failed payments</h3>
          <p>
            If a payment fails, Stripe retries it according to its standard schedule. If the
            subscription lapses, your workspace returns to the Free plan. We do not delete your scan
            history solely because a payment failed.
          </p>
        </section>

        <section className="legal-section">
          <h2>7. Cancelling your subscription</h2>
          <p>
            You can cancel at any time from <strong>Manage billing</strong> in the dashboard, which
            opens the Stripe billing portal. No reason is required and no cancellation fee applies.
          </p>
          <p>
            Cancelling stops future renewals. Your Pro access continues until the end of the period
            you have already paid for, after which the workspace returns to the Free plan. On the
            Free plan your existing data is retained, but Pro-only features stop and you cannot add
            guarded apps beyond the Free limit.
          </p>
          <p>
            Outside the statutory withdrawal right in section 8, fees already paid for the current
            period are not refunded on cancellation, except where applicable law requires it or
            where these Terms say otherwise.
          </p>
          <p>
            To delete your account entirely, contact us through{' '}
            <Link href={TERMS_CONTACT_HREF}>our contact form</Link>. Deletion removes your workspace
            records, except those we must keep for legal reasons such as invoices — see the
            retention table in our <Link href="/privacy">Privacy Policy</Link>.
          </p>
        </section>

        <section className="legal-section important-notice">
          <h2>8. Right of withdrawal — consumers</h2>
          <p>
            <strong>This section applies only if you are a consumer</strong> in the European Union,
            the European Economic Area, or the United Kingdom. It is in addition to your right to
            cancel under section 7.
          </p>
          <p>
            You have the right to withdraw from a paid subscription within <strong>14 days</strong>{' '}
            of the day the contract is concluded, without giving any reason.
          </p>
          <p>
            To withdraw, tell us clearly that you are withdrawing before the 14 days expire. The
            simplest way is{' '}
            <Link href={TERMS_CONTACT_HREF}>
              our contact form with the Terms of Service subject
            </Link>{' '}
            preselected; any other unambiguous statement is equally valid. You may use the model
            declaration below, but you are not obliged to.
          </p>

          <h3>8.1 Model withdrawal declaration</h3>
          <div className="legal-model-form">
            <p>To Tibor Kútik, Hlavná 454, 941 33 Kolta, Slovak Republic:</p>
            <p>
              I hereby give notice that I withdraw from my contract for the supply of the following
              digital service: Assurly Pro subscription.
            </p>
            <p>Ordered on: [DATE]</p>
            <p>Name of consumer: [YOUR NAME]</p>
            <p>Address of consumer: [YOUR ADDRESS]</p>
            <p>Account email: [EMAIL USED FOR THE ACCOUNT]</p>
            <p>Date: [DATE]</p>
          </div>

          <h3>8.2 Effects of withdrawal</h3>
          <p>
            We will refund all payments received from you for that subscription without undue delay,
            and in any event within <strong>14 days</strong> of the day we are informed of your
            withdrawal. We refund using the same payment method you used, and you will not incur any
            fee for the refund.
          </p>
          <p>
            We do <strong>not</strong> apply a proportionate deduction for the period during which
            the Service was already supplied to you. If you withdraw during the free trial, no
            payment has been taken, so no refund arises — access simply ends.
          </p>
          <p>
            After withdrawal you must stop using the paid features, and we may restrict your
            workspace to the Free plan.
          </p>
        </section>

        <section className="legal-section">
          <h2>9. Your code and your data</h2>
          <p>
            <strong>You retain all rights in your source code, configurations, and content</strong>{' '}
            (&quot;Your Content&quot;). We claim no ownership of it.
          </p>
          <p>
            You grant us a limited, worldwide, non-exclusive, royalty-free licence to host, copy,
            transmit, parse, analyse, and display Your Content solely to the extent needed to
            operate the Service for you, and only for as long as needed. We do not use Your Content
            to train machine-learning models, and we do not sell it.
          </p>
          <p>
            <strong>Auto-fix pull requests:</strong> where you enable them, we open pull requests
            against your repository containing proposed changes. We never merge them. You are
            responsible for reviewing, testing, and deciding whether to merge any proposed change.
          </p>
          <p>
            <strong>Public badges, trust pages, and share links:</strong> if you enable one, you
            authorise us to publish the associated verdict, Ship Score, and finding summary for that
            target. A share link is accessible to anyone holding it until you revoke it. You can
            revoke or disable these at any time.
          </p>
          <p>
            You confirm that you have the right to submit Your Content to the Service and to
            authorise the scanning and probing you request. Please do not deliberately submit live
            production secrets or credentials.
          </p>
          <p>
            <strong>Feedback:</strong> if you send us suggestions, we may use them freely to improve
            the Service without obligation to you.
          </p>
        </section>

        <section className="legal-section">
          <h2>10. Our intellectual property and open-source components</h2>
          <p>
            The hosted Service, the dashboard, our detection rules and scoring logic, and the
            Assurly name, logo, and visual identity are our property or that of our licensors, and
            are protected by intellectual property law. These Terms grant you a limited, revocable,
            non-exclusive, non-transferable right to use the Service for your own internal,
            business, or educational purposes — nothing more.
          </p>
          <p>
            Our published npm packages — <code>assurly</code>, <code>@assurly/scanner-core</code>,
            and <code>@assurly/mcp-server</code> — are distributed under the{' '}
            <strong>MIT License</strong>. That licence governs your use of those packages, and
            nothing in these Terms restricts the rights it grants you. It does not grant rights in
            our name, logo, or trademarks, or in the hosted Service.
          </p>
          <p>
            The Service includes third-party open-source components licensed under their own terms.
          </p>
          <p>
            Except where mandatory law permits it or the MIT License allows it, you may not copy,
            modify, reverse engineer, or create derivative works of the hosted Service, or remove
            proprietary notices.
          </p>
        </section>

        <section className="legal-section important-notice">
          <h2>11. Acceptable use</h2>
          <p>
            <strong>Scan only what you own or what you are authorised in writing to test.</strong>{' '}
            Live URL probing sends real requests to a real system. You are solely responsible for
            holding the necessary authorisation, and our ownership-verification step does not
            replace it.
          </p>
          <p>You must not:</p>
          <ul>
            <li>
              scan, probe, or analyse a repository, application, or URL you do not own and are not
              authorised to test;
            </li>
            <li>
              use the Service to attack, overload, disrupt, or gain unauthorised access to any
              system;
            </li>
            <li>
              circumvent rate limits, plan entitlements, authentication, or any other technical
              restriction;
            </li>
            <li>
              share, resell, or sublicense API keys or Service access outside an OEM agreement;
            </li>
            <li>
              display a badge or verdict for a target that does not genuinely hold it, or continue
              to display one after it ceases to be accurate;
            </li>
            <li>
              misrepresent scan findings for deceptive, fraudulent, or malicious purposes, including
              presenting an Assurly result as a security certification;
            </li>
            <li>
              scrape the Service, abuse our GitHub integration, or extract data other than through
              documented interfaces;
            </li>
            <li>upload unlawful content or use the Service in breach of applicable law.</li>
          </ul>
        </section>

        <section className="legal-section">
          <h2>12. Third-party services</h2>
          <p>
            The Service depends on GitHub (sign-in and repository access), Stripe (payments),
            Anthropic (AI features), Supabase (authentication and database), Vercel (hosting), and
            Resend (email). Your use of those providers&apos; own products is governed by their
            terms, and we are not responsible for their availability or for changes they make.
          </p>
          <p>
            You can revoke our access at any time by uninstalling the GitHub App or revoking the
            OAuth authorisation in your GitHub settings. Doing so will disable the features that
            depend on it.
          </p>
        </section>

        <section className="legal-section">
          <h2>13. AI features</h2>
          <p>
            AI deep review and generated remediation prompts are <strong>optional features</strong>{' '}
            powered by Anthropic&apos;s Claude models. When you use them,{' '}
            <strong>you are interacting with an AI system</strong>. Section 6 of our{' '}
            <Link href="/privacy">Privacy Policy</Link> sets out exactly what is sent and what is
            not.
          </p>
          <p>
            AI output is generated automatically, is advisory, and may be inaccurate, incomplete, or
            outdated. It must not be your sole basis for a security decision — apply your own review
            before acting on it. AI output does not make decisions producing legal or similarly
            significant effects concerning you.
          </p>
          <p>
            We may apply fair-use limits to AI features to keep the Service available for everyone.
          </p>
        </section>

        <section className="legal-section">
          <h2>14. Availability and changes to the Service</h2>
          <p>
            We work to keep the Service available, but the Free and Pro plans come with{' '}
            <strong>no uptime commitment or service level agreement</strong>. Access may be
            interrupted by maintenance, third-party outages, or events outside our control. OEM and
            platform customers may agree separate service levels in writing.
          </p>
          <p>
            We may modify the Service — for example to add or adapt features, respond to security
            issues, keep pace with the platforms we integrate with, or comply with the law. Where a
            modification goes beyond what is needed to keep the Service in conformity and{' '}
            <strong>negatively affects your access or use in more than a minor way</strong>, we
            will:
          </p>
          <ul>
            <li>make the modification at no additional cost to you;</li>
            <li>
              inform you at least <strong>30 days</strong> in advance, on a durable medium, of the
              features affected and the date of the change; and
            </li>
            <li>
              allow you to terminate free of charge within 30 days of receiving that notice, or of
              the change taking effect if later, with a pro-rata refund of fees you have paid for
              the unused remainder of the period.
            </li>
          </ul>
          <p>
            If we discontinue the Service entirely, we will give at least 30 days&apos; notice and
            refund the unused portion of any prepaid fees.
          </p>
        </section>

        <section className="legal-section">
          <h2>15. Statutory guarantee of conformity — consumers</h2>
          <p>
            <strong>This section applies only if you are a consumer</strong> in the European Union,
            the European Economic Area, or the United Kingdom.
          </p>
          <p>
            We are liable to you for any lack of conformity of the digital service that exists at
            the time of supply and becomes apparent within the period set by applicable law — for a
            subscription supplied continuously, throughout the period of supply.
          </p>
          <p>
            If the Service is not in conformity, you are entitled to have it brought into
            conformity, and where that is impossible, disproportionate, or not done within a
            reasonable time, to a proportionate price reduction or to terminate the contract, in
            each case as provided by law. Nothing in sections 16 and 17 limits these rights.
          </p>
        </section>

        <section className="legal-section important-notice">
          <h2>16. Disclaimer of warranties</h2>
          <p>
            <strong>
              To the fullest extent permitted by applicable law, the Service is provided &quot;as
              is&quot; and &quot;as available&quot;, without warranties of any kind, express or
              implied,
            </strong>{' '}
            including implied warranties of merchantability, fitness for a particular purpose,
            accuracy, and non-infringement.
          </p>
          <p>In particular, we do not warrant that:</p>
          <ul>
            <li>the Service will detect every security issue, misconfiguration, or defect;</li>
            <li>every finding it reports is genuine or correctly prioritised;</li>
            <li>
              an application that passes a scan is secure, compliant, or ready for production; or
            </li>
            <li>the Service will be uninterrupted, timely, or error-free.</li>
          </ul>
          <p>
            If you are a consumer, this section applies only to the extent permitted by law and does
            not affect your rights under section 15.
          </p>
        </section>

        <section className="legal-section">
          <h2>17. Limitation of liability</h2>
          <p>
            <strong>Nothing in these Terms excludes or limits our liability</strong> for death or
            personal injury caused by our negligence, for fraud or fraudulent misrepresentation, for
            gross negligence or wilful misconduct, or for any other liability that cannot lawfully
            be excluded — including liability under mandatory consumer protection or product
            liability law.
          </p>
          <p>Subject to that paragraph, and to the fullest extent permitted by law:</p>
          <ul>
            <li>
              we are not liable for indirect, incidental, special, consequential, or punitive
              damages, or for loss of profits, revenue, business, goodwill, or anticipated savings;
            </li>
            <li>
              we are not liable for losses arising from a security issue the Service did not detect,
              from acting or failing to act on a finding, verdict, Ship Score, or AI-generated
              suggestion, or from merging a proposed fix;
            </li>
            <li>
              we are not liable for outages, database connection pool exhaustion, data loss,
              unverified or spoofed payment webhooks, exposed secrets, or breaches affecting your
              own systems or those of your providers; and
            </li>
            <li>
              our total aggregate liability for all claims arising out of or relating to the Service
              is limited to the greater of the fees you paid us in the <strong>12 months</strong>{' '}
              before the event giving rise to the claim and <strong>€100</strong>.
            </li>
          </ul>
          <p>
            If you are a consumer, the exclusions above apply only to the extent permitted by law;
            we remain liable for foreseeable loss caused by our breach of a material obligation
            under these Terms.
          </p>
          <p>
            If you are a business customer, you must bring any claim within 12 months of becoming
            aware of the circumstances giving rise to it.
          </p>
        </section>

        <section className="legal-section">
          <h2>18. Indemnity — business customers</h2>
          <p>
            <strong>This section applies only to business customers.</strong> You will indemnify and
            hold us harmless against claims, losses, and reasonable costs arising from your breach
            of section 11 (acceptable use), from scanning or probing a system you were not
            authorised to test, or from Your Content infringing a third party&apos;s rights. We will
            notify you of any such claim and will not settle it without your consent, not to be
            unreasonably withheld.
          </p>
        </section>

        <section className="legal-section">
          <h2>19. Suspension and termination</h2>
          <p>
            You may stop using the Service, cancel your subscription, or request account deletion at
            any time.
          </p>
          <p>
            We may suspend or terminate your access if you materially breach these Terms, use the
            Service unlawfully, put the Service or other users at risk, or fail to pay. Where it is
            reasonable and lawful to do so, we will give you notice and an opportunity to put the
            breach right first; we may act immediately in serious cases such as unauthorised
            scanning or an active threat to the Service.
          </p>
          <p>
            If we terminate for a reason other than your material breach, we refund the unused
            portion of any prepaid fees. On termination your right to use the Service ends; sections
            9, 10, 16, 17, 18, 21, and 22 survive.
          </p>
        </section>

        <section className="legal-section">
          <h2>20. Changes to these Terms</h2>
          <p>
            We may update these Terms to reflect changes to the Service, our business, or the law.
            We will update the &quot;Last updated&quot; date above.
          </p>
          <p>
            For changes that materially affect your rights or obligations, we will give you at least{' '}
            <strong>30 days&apos;</strong> notice by email or in the application before they take
            effect. If you do not accept them, cancel before the effective date and we will refund
            the unused portion of any prepaid fees. Continuing to use the Service after that date
            means you accept the updated Terms.
          </p>
        </section>

        <section className="legal-section">
          <h2>21. Governing law, jurisdiction, and disputes</h2>
          <p>
            These Terms are governed by the law of the Slovak Republic, excluding its conflict of
            law rules and the UN Convention on Contracts for the International Sale of Goods.
          </p>
          <p>
            <strong>If you are a consumer,</strong> this choice of law does not deprive you of the
            protection of mandatory provisions of the law of your country of habitual residence, and
            you may bring proceedings in the courts of your place of domicile.
          </p>
          <p>
            <strong>If you are a business customer,</strong> the courts of the Slovak Republic have
            exclusive jurisdiction.
          </p>

          <h3>21.1 Complaints and alternative dispute resolution</h3>
          <p>
            Please contact us first through <Link href={TERMS_CONTACT_HREF}>our contact form</Link>{' '}
            — most issues are resolved quickly. We aim to respond substantively within 30 days.
          </p>
          <p>
            If you are a consumer and we cannot resolve the matter, you may refer the dispute to an
            alternative dispute resolution body. In Slovakia the competent body is the{' '}
            <strong>Slovenská obchodná inšpekcia</strong> (Slovak Trade Inspection),{' '}
            <a href="https://www.soi.sk" target="_blank" rel="noopener noreferrer">
              soi.sk
            </a>
            , under Act No. 391/2015 Coll. on alternative resolution of consumer disputes. Consumers
            elsewhere in the EEA can find their national body through their European Consumer
            Centre.
          </p>
          <p>
            The European Commission&apos;s Online Dispute Resolution platform ceased operating on 20
            July 2025 and is no longer available.
          </p>
        </section>

        <section className="legal-section">
          <h2>22. General</h2>
          <ul>
            <li>
              <strong>Entire agreement:</strong> these Terms and the Privacy Policy are the entire
              agreement between us regarding the Service and replace any earlier understanding, save
              for a signed OEM order form, which prevails where it conflicts.
            </li>
            <li>
              <strong>Severability:</strong> if a provision is held invalid, the rest remains in
              force and the invalid provision is replaced by the closest valid equivalent.
            </li>
            <li>
              <strong>No waiver:</strong> not enforcing a right does not waive it.
            </li>
            <li>
              <strong>Assignment:</strong> you may not assign these Terms without our consent. We
              may assign them to a successor in connection with a merger, acquisition, or sale of
              assets, on notice to you; if you are a consumer and this worsens your position, you
              may terminate free of charge.
            </li>
            <li>
              <strong>Force majeure:</strong> neither party is liable for failure caused by events
              beyond its reasonable control.
            </li>
            <li>
              <strong>Notices:</strong> we contact you at the email address on your account; you
              contact us through the contact form.
            </li>
            <li>
              <strong>Language:</strong> these Terms are concluded in English, and the English
              version governs. Any translation is for convenience only.
            </li>
            <li>
              <strong>No third-party rights:</strong> no one other than you and us has the right to
              enforce these Terms.
            </li>
          </ul>
        </section>

        <section className="legal-section">
          <h2>23. Contact</h2>
          <p>
            Questions about these Terms, cancellations, and withdrawal declarations all go through{' '}
            <Link href={TERMS_CONTACT_HREF}>our contact form</Link>, which opens with the{' '}
            <em>Terms of Service</em> subject already selected. Using the form means your message
            reaches us with the right category and is not lost to a spam filter.
          </p>
        </section>
      </main>
      <SiteFooter variant="full" />
    </div>
  );
}
