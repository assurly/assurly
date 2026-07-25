// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import TrustPage from './page';

describe('TrustPage (SOC2-lite)', () => {
  afterEach(cleanup);

  it('renders the security posture sections', () => {
    render(<TrustPage />);
    // Heading-role queries, not getByText: the body prose legitimately repeats
    // these words (e.g. "subprocessors" in the out-of-scope list), and a bare
    // text match breaks on unrelated copy edits.
    expect(screen.getByRole('heading', { level: 1, name: /trust & security/i })).toBeTruthy();
    expect(
      screen.getByRole('heading', { level: 2, name: /Tenant isolation and access control/i }),
    ).toBeTruthy();
    expect(
      screen.getByRole('heading', { level: 2, name: /Active probing requires proven ownership/i }),
    ).toBeTruthy();
    expect(screen.getByRole('heading', { level: 2, name: /Subprocessors/i })).toBeTruthy();
    expect(
      screen.getByRole('heading', { level: 2, name: /Reporting a vulnerability/i }),
    ).toBeTruthy();
  });

  it('does not claim a certification it does not hold', () => {
    const { container } = render(<TrustPage />);
    const text = container.textContent ?? '';
    // The page may only mention SOC 2 / ISO 27001 to disclaim them. A future edit
    // that turns this into a positive claim is a compliance problem, not a typo.
    expect(text).toMatch(/is not SOC 2 audited and does not hold ISO\/IEC 27001 certification/i);
  });

  it('states posture only — no per-customer identifiers appear', () => {
    const { container } = render(<TrustPage />);
    const text = container.textContent ?? '';
    // A static posture page must never render a customer email, org id, or token.
    expect(text).not.toMatch(/organization_id/);
    expect(text).not.toMatch(/[a-z0-9._%+-]+@(?!.*assurly\.dev)[a-z0-9.-]+\.[a-z]{2,}/i);
  });
});
