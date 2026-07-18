// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import TrustPage from './page';

describe('TrustPage (SOC2-lite)', () => {
  afterEach(cleanup);

  it('renders the security posture sections', () => {
    render(<TrustPage />);
    expect(screen.getByRole('heading', { level: 1, name: /trust & security/i })).toBeTruthy();
    expect(screen.getByText(/Our security posture/i)).toBeTruthy();
    expect(screen.getByText(/Active probing requires proven ownership/i)).toBeTruthy();
    expect(screen.getByText(/Subprocessors/i)).toBeTruthy();
  });

  it('states posture only — no per-customer identifiers appear', () => {
    const { container } = render(<TrustPage />);
    const text = container.textContent ?? '';
    // A static posture page must never render a customer email, org id, or token.
    expect(text).not.toMatch(/organization_id/);
    expect(text).not.toMatch(/[a-z0-9._%+-]+@(?!.*assurly\.dev)[a-z0-9.-]+\.[a-z]{2,}/i);
  });
});
