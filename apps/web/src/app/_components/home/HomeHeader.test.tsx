import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { HomeHeader } from './HomeHeader';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
}));

const baseProps = {
  menuOpen: false,
  onMenuChange: vi.fn(),
};

describe('HomeHeader — navbar sign-in target', () => {
  it('points the anonymous "Sign In" link at the OAuth login route', () => {
    const html = renderToStaticMarkup(
      <HomeHeader {...baseProps} authenticated={false} loginUrl="/api/auth/login" />,
    );

    expect(html).toContain('href="/api/auth/login"');
    expect(html).toContain('Sign In');
  });

  it('never falls back to the non-existent /auth route (404 regression guard)', () => {
    const html = renderToStaticMarkup(
      <HomeHeader {...baseProps} authenticated={false} loginUrl="/api/auth/login" />,
    );

    expect(html).not.toContain('href="/auth"');
  });

  it('honours an absolute canonical login URL passed from the server', () => {
    const html = renderToStaticMarkup(
      <HomeHeader
        {...baseProps}
        authenticated={false}
        loginUrl="https://app.example.com/api/auth/login"
      />,
    );

    expect(html).toContain('href="https://app.example.com/api/auth/login"');
  });

  it('routes authenticated users to the dashboard instead of the login route', () => {
    const html = renderToStaticMarkup(
      <HomeHeader {...baseProps} authenticated loginUrl="/api/auth/login" />,
    );

    expect(html).toContain('href="/dashboard"');
    expect(html).toContain('Go to Dashboard');
    expect(html).not.toContain('href="/api/auth/login"');
  });

  it('accepts product-page nav overrides and a home-linked logo', () => {
    const html = renderToStaticMarkup(
      <HomeHeader
        {...baseProps}
        authenticated={false}
        loginUrl="/api/auth/login"
        logoHref="/"
        navLinks={[
          { href: '/#features', label: 'Features' },
          { href: '/mcp', label: 'MCP Server', current: true },
        ]}
      />,
    );

    expect(html).toContain('href="/"');
    expect(html).toContain('href="/#features"');
    expect(html).toContain('aria-current="page"');
    expect(html).toContain('hamburger-btn');
    expect(html).toContain('id="primary-navigation"');
  });
});
