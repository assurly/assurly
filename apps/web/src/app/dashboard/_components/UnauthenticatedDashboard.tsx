import Link from 'next/link';
import type { ReactElement } from 'react';
import { ThemeToggle } from '../../_components/ThemeToggle';
import { AssurlyLogo } from './icons/AssurlyLogo';
import { DashboardLockIcon } from './icons/DashboardIcons';
import { SESSION_EXPIRED_MESSAGE } from '../../../utils/unauthorizedSession';

interface UnauthenticatedDashboardProps {
  loginUrl: string;
  sessionExpired?: boolean;
}

export function UnauthenticatedDashboard({
  loginUrl,
  sessionExpired = false,
}: UnauthenticatedDashboardProps): ReactElement {
  return (
    <main className="unauth-grid">
      <section className="unauth-left">
        <div>
          <div className="unauth-brand-row">
            <Link href="/" className="unauth-brand">
              <AssurlyLogo />
            </Link>
            <ThemeToggle />
          </div>
          {sessionExpired ? (
            <>
              <h1>Your session expired.</h1>
              <p>{SESSION_EXPIRED_MESSAGE}</p>
            </>
          ) : (
            <>
              <h1>
                Secure your code before it reaches <span>production.</span>
              </h1>
              <p>
                Assurly runs local static analysis for Next.js, Supabase, and Stripe projects while
                keeping repository access scoped to your workspace.
              </p>
            </>
          )}
          <a href={loginUrl} className="btn btn-primary">
            Sign in with GitHub
          </a>
          <p className="unauth-privacy">
            <DashboardLockIcon />
            OAuth credentials stay in secure HttpOnly cookies.
          </p>
        </div>
      </section>
      <aside className="unauth-right" aria-label="Assurly benefits">
        <div className="login-card">
          <h2>Production readiness, in one workspace</h2>
          <ul>
            <li>✓ Tenant-isolated repository history</li>
            <li>✓ Actionable security findings</li>
            <li>✓ Local manual project checker</li>
          </ul>
          <Link href="/">Back to landing page</Link>
        </div>
      </aside>
    </main>
  );
}
