import Link from 'next/link';
import { ShipReadyLogo } from './icons/ShipReadyLogo';
import { DashboardLockIcon } from './icons/DashboardIcons';

interface UnauthenticatedDashboardProps {
  loginUrl: string;
}

export function UnauthenticatedDashboard({
  loginUrl,
}: UnauthenticatedDashboardProps): React.ReactElement {
  return (
    <main className="unauth-grid">
      <section className="unauth-left">
        <div>
          <Link href="/" className="unauth-brand" aria-label="ShipReady home">
            <ShipReadyLogo />
          </Link>
          <h1>
            Secure your code before it reaches <span>production.</span>
          </h1>
          <p>
            ShipReady runs local static analysis for Next.js, Supabase, and Stripe projects while
            keeping repository access scoped to your workspace.
          </p>
          <a href={loginUrl} className="btn btn-primary">
            Sign in with GitHub
          </a>
          <p className="unauth-privacy">
            <DashboardLockIcon />
            OAuth credentials stay in secure HttpOnly cookies.
          </p>
        </div>
      </section>
      <aside className="unauth-right" aria-label="ShipReady benefits">
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
