// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

vi.mock('next/headers', () => ({
  headers: async () => ({
    get: (name: string): string | null => {
      if (name === 'host') return 'localhost:3000';
      if (name === 'cookie') return '';
      return null;
    },
  }),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
}));

import TrustPage from './page';

async function renderTrust() {
  process.env.APP_URL = process.env.APP_URL?.trim() || 'http://localhost:3000';
  return render(await TrustPage());
}

describe('TrustPage (SOC2-lite)', () => {
  afterEach(cleanup);

  it('renders the security posture sections', async () => {
    await renderTrust();
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

  it('does not claim a certification it does not hold', async () => {
    const { container } = await renderTrust();
    const text = container.textContent ?? '';
    // The page may only mention SOC 2 / ISO 27001 to disclaim them. A future edit
    // that turns this into a positive claim is a compliance problem, not a typo.
    expect(text).toMatch(/is not SOC 2 audited and does not hold ISO\/IEC 27001 certification/i);
  });

  it('states posture only — no per-customer identifiers appear', async () => {
    const { container } = await renderTrust();
    const text = container.textContent ?? '';
    // A static posture page must never render a customer email, org id, or token.
    expect(text).not.toMatch(/organization_id/);
    expect(text).not.toMatch(/[a-z0-9._%+-]+@(?!.*assurly\.dev)[a-z0-9.-]+\.[a-z]{2,}/i);
  });

  it('uses the landing hamburger chrome so the theme toggle is not a second header row', async () => {
    const { container } = await renderTrust();
    expect(container.querySelector('.legal-header')).toBeNull();
    expect(container.querySelector('.hamburger-btn')).toBeTruthy();
    expect(container.querySelector('nav .theme-toggle')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Open navigation' })).toBeTruthy();
  });
});
