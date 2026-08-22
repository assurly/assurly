import { headers } from 'next/headers';
import type { ReactElement } from 'react';
import DashboardClient from './_components/DashboardClient';
import type { SessionResult } from '../../utils/clientApi';
import { AuthenticationError, requireUser } from '../../utils/auth';
import { getAdminDbAdapter } from '../../utils/dbAdapter';
import { isBillingConfigured, resolveApplicationUrlFromHost } from '../../utils/env';
import { getStripeClient } from '../../utils/stripe';
import { reconcileOrganizationBilling } from '../../utils/stripeReconcile';
import { getE2eDashboardSession, resolveE2eTrendPoints } from '../../testing/e2eDashboardFixture';

interface DashboardPageProps {
  searchParams: Promise<{
    success?: string | string[];
    billing?: string | string[];
    cancel?: string | string[];
    view?: string | string[];
    repo?: string | string[];
  }>;
}

function firstQueryValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function shouldReconcileBilling(success: string | undefined, billing: string | undefined): boolean {
  return success === 'stripe_upgrade' || billing === 'sync';
}

async function loadDashboardSession(reconcileBilling: boolean): Promise<SessionResult> {
  const fixtureSession = getE2eDashboardSession();
  if (fixtureSession) {
    return fixtureSession;
  }

  const requestHeaders = await headers();
  const request = new Request('http://assurly.local/dashboard', {
    headers: { cookie: requestHeaders.get('cookie') ?? '' },
  });

  try {
    const auth = await requireUser(request);
    let organization = await auth.db.getOrganizationByUserId(auth.user.id);
    if (reconcileBilling && organization && organization.billing_plan !== 'oem') {
      try {
        await reconcileOrganizationBilling(getStripeClient(), getAdminDbAdapter(), organization);
        organization = await auth.db.getOrganizationByUserId(auth.user.id);
      } catch (error) {
        console.warn('[Assurly] dashboard billing reconcile failed:', (error as Error).message);
      }
    }
    const repositories = organization ? await auth.db.getRepositories(organization.id) : [];
    return { user: auth.user, organization, repositories };
  } catch (error) {
    if (error instanceof AuthenticationError) {
      return { user: null, organization: null, repositories: [] };
    }
    throw error;
  }
}

export default async function DashboardPage({
  searchParams,
}: DashboardPageProps): Promise<ReactElement> {
  const requestHeaders = await headers();
  const appUrl = resolveApplicationUrlFromHost(
    requestHeaders.get('x-forwarded-host') ?? requestHeaders.get('host'),
    requestHeaders.get('x-forwarded-proto'),
  );
  const resolvedSearchParams = await searchParams;

  const initialSession = await loadDashboardSession(
    shouldReconcileBilling(
      firstQueryValue(resolvedSearchParams.success),
      firstQueryValue(resolvedSearchParams.billing),
    ),
  );
  const fixtureSession = getE2eDashboardSession();
  const firstRepoId = initialSession.repositories[0]?.id;
  const initialTrendPoints =
    fixtureSession && firstRepoId ? resolveE2eTrendPoints(firstRepoId) : undefined;

  return (
    <DashboardClient
      initialSession={initialSession}
      loginUrl={new URL('/api/auth/login', appUrl).toString()}
      initialTrendPoints={initialTrendPoints}
      billingEnabled={isBillingConfigured()}
    />
  );
}
