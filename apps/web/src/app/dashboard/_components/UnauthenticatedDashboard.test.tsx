import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { UnauthenticatedDashboard } from './UnauthenticatedDashboard';
import { SESSION_EXPIRED_MESSAGE } from '../../../utils/unauthorizedSession';

describe('UnauthenticatedDashboard', () => {
  it('renders the marketing sign-in boundary by default', () => {
    const html = renderToStaticMarkup(
      <UnauthenticatedDashboard loginUrl="http://localhost:3000/api/auth/login" />,
    );
    expect(html).toContain('class="unauth-grid"');
    expect(html).toContain('Sign in with GitHub');
    expect(html).toContain('Secure your code before it reaches');
    expect(html).toContain('href="http://localhost:3000/api/auth/login"');
    expect(html).not.toContain(SESSION_EXPIRED_MESSAGE);
  });

  it('replaces marketing copy with the session-expired re-auth chrome', () => {
    const html = renderToStaticMarkup(
      <UnauthenticatedDashboard loginUrl="http://localhost:3000/api/auth/login" sessionExpired />,
    );
    expect(html).toContain('class="unauth-grid"');
    expect(html).toContain(SESSION_EXPIRED_MESSAGE);
    expect(html).toContain('Sign in with GitHub');
    expect(html).toContain('href="http://localhost:3000/api/auth/login"');
    expect(html).not.toContain('Secure your code before it reaches');
  });
});
