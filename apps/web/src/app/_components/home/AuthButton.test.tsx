import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { AuthButton } from './AuthButton';

const mockPush = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, replace: vi.fn(), prefetch: vi.fn() }),
}));

const baseProps = {
  variant: 'primary' as const,
  labels: { signIn: 'Sign In', dashboard: 'Go to Dashboard' },
  loginUrl: 'https://app.example.com/api/auth/login',
  onNavigate: vi.fn(),
};

describe('AuthButton — hydration contract', () => {
  it('always renders an <a> element (never <Link> wrapper) for anonymous users', () => {
    const html = renderToStaticMarkup(<AuthButton {...baseProps} authenticated={false} />);
    expect(html).toMatch(/^<a /);
    expect(html).toContain('href="https://app.example.com/api/auth/login"');
    expect(html).toContain('Sign In');
    expect(html).not.toContain('Go to Dashboard');
  });

  it('always renders an <a> element (never <Link> wrapper) for authenticated users', () => {
    const html = renderToStaticMarkup(<AuthButton {...baseProps} authenticated />);
    expect(html).toMatch(/^<a /);
    expect(html).toContain('href="/dashboard"');
    expect(html).toContain('Go to Dashboard');
    expect(html).not.toContain('Sign In');
  });

  it('server HTML for anonymous matches server HTML structure for authenticated (same element type)', () => {
    const htmlAnon = renderToStaticMarkup(<AuthButton {...baseProps} authenticated={false} />);
    const htmlAuth = renderToStaticMarkup(<AuthButton {...baseProps} authenticated />);
    // Both must open with <a and close with </a> — no context provider wrapper
    expect(htmlAnon).toMatch(/^<a .*<\/a>$/);
    expect(htmlAuth).toMatch(/^<a .*<\/a>$/);
  });

  it('applies the variant class to both states', () => {
    const htmlAnon = renderToStaticMarkup(
      <AuthButton {...baseProps} authenticated={false} variant="secondary" />,
    );
    const htmlAuth = renderToStaticMarkup(
      <AuthButton {...baseProps} authenticated variant="secondary" />,
    );
    expect(htmlAnon).toContain('class="btn btn-secondary"');
    expect(htmlAuth).toContain('class="btn btn-secondary"');
  });
});
