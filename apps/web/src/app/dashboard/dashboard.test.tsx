import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import DashboardClient from './_components/DashboardClient';
import type { SessionResult } from '../../utils/clientApi';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('./_components/manual-checker/ManualChecker', () => ({
  default: () => <div data-testid="manual-checker">Manual checker</div>,
}));

const anonymous: SessionResult = { user: null, organization: null, repositories: [] };
const authenticated: SessionResult = {
  user: { id: 'user-1', name: 'Tibor Dev', email: 'dev@example.com', avatar_url: '' },
  organization: {
    id: 'org-1',
    name: 'Acme',
    billing_plan: 'free',
    created_at: '2026-06-21T00:00:00Z',
  },
  repositories: [
    {
      id: 'repo-1',
      organization_id: 'org-1',
      name: 'acme/app',
      github_repo_id: 42,
      is_active: true,
      created_at: '2026-06-21T00:00:00Z',
    },
  ],
};

describe('DashboardClient', () => {
  it('renders the sign-in boundary for an anonymous server session', () => {
    const html = renderToStaticMarkup(<DashboardClient initialSession={anonymous} />);
    expect(html).toContain('class="unauth-grid"');
    expect(html).toContain('Sign in with GitHub');
  });

  it('uses the configured canonical origin at the dashboard sign-in boundary', () => {
    const html = renderToStaticMarkup(
      <DashboardClient
        initialSession={anonymous}
        loginUrl="http://localhost:3000/api/auth/login"
      />,
    );
    expect(html).toContain('href="http://localhost:3000/api/auth/login"');
  });

  it('renders only the repositories supplied by the tenant-scoped server loader', () => {
    const html = renderToStaticMarkup(<DashboardClient initialSession={authenticated} />);
    expect(html).toContain('acme/app');
    expect(html).toContain('Tibor Dev');
    expect(html).not.toContain('other-tenant');
  });
});
