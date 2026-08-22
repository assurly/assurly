import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import HomeClient from './_components/home/HomeClient';
import { OAuthCodeRecovery } from './_components/home/OAuthCodeRecovery';
import { PRO_TRIAL_COPY } from '../utils/pricing';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/',
}));

describe('HomeClient', () => {
  it('renders a stable sign-in URL for anonymous users', () => {
    const html = renderToStaticMarkup(<HomeClient initialAuthenticated={false} />);
    expect(html).toContain('href="/api/auth/login"');
    expect(html).not.toContain('/api/auth/login?t=');
  });

  it('routes authenticated users to their dashboard', () => {
    const html = renderToStaticMarkup(<HomeClient initialAuthenticated />);
    expect(html).toContain('href="/dashboard"');
    expect(html).toContain('Go to Dashboard');
  });

  it('uses the configured canonical origin for anonymous sign-in', () => {
    const html = renderToStaticMarkup(
      <HomeClient initialAuthenticated={false} loginUrl="http://localhost:3000/api/auth/login" />,
    );
    expect(html).toContain('href="http://localhost:3000/api/auth/login"');
  });

  it('recovers an OAuth code through the canonical callback', () => {
    const html = renderToStaticMarkup(
      <OAuthCodeRecovery callbackUrl="http://localhost:3000/api/auth/callback?code=safe-code" />,
    );
    expect(html).toContain('Completing secure sign-in');
    expect(html).toContain('href="http://localhost:3000/api/auth/callback?code=safe-code"');
  });

  it('keeps the scanner, pricing, and contact landmarks discoverable', () => {
    const html = renderToStaticMarkup(<HomeClient initialAuthenticated={false} />);
    expect(html).toContain('Scan a Public Repository Instantly');
    expect(html).toContain('id="pricing"');
    expect(html).toContain('id="contact"');
  });

  it('advertises the 3-day Pro trial on the pricing card', () => {
    const html = renderToStaticMarkup(<HomeClient initialAuthenticated={false} />);
    expect(html).toContain(PRO_TRIAL_COPY.sectionHint);
    expect(html).toContain(PRO_TRIAL_COPY.featureBullet);
    expect(html).toContain(PRO_TRIAL_COPY.cta);
  });
});
