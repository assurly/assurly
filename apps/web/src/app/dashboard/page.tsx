import { headers } from 'next/headers';
import DashboardClient from './_components/DashboardClient';
import type { SessionResult } from '../../utils/clientApi';
import { AuthenticationError, requireUser } from '../../utils/auth';
import { resolveApplicationUrlFromHost } from '../../utils/env';
import { getE2eDashboardSession } from '../../testing/e2eDashboardFixture';

async function loadDashboardSession(): Promise<SessionResult> {
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
    const organization = await auth.db.getOrganizationByUserId(auth.user.id);
    const repositories = organization ? await auth.db.getRepositories(organization.id) : [];
    return { user: auth.user, organization, repositories };
  } catch (error) {
    if (error instanceof AuthenticationError) {
      return { user: null, organization: null, repositories: [] };
    }
    throw error;
  }
}

export default async function DashboardPage(): Promise<React.ReactElement> {
  const requestHeaders = await headers();
  const appUrl = resolveApplicationUrlFromHost(
    requestHeaders.get('x-forwarded-host') ?? requestHeaders.get('host'),
    requestHeaders.get('x-forwarded-proto'),
  );

  return (
    <DashboardClient
      initialSession={await loadDashboardSession()}
      loginUrl={new URL('/api/auth/login', appUrl).toString()}
    />
  );
}
