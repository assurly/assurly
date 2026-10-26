// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/headers', () => ({
  headers: async () => ({
    get: (name: string): string | null =>
      name === 'host' ? 'localhost:3000' : name === 'cookie' ? '' : null,
  }),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
}));

import SsoErrorPage, { metadata } from './page';

async function renderFor(reason?: string) {
  process.env.APP_URL = process.env.APP_URL?.trim() || 'http://localhost:3000';
  return render(await SsoErrorPage({ searchParams: Promise.resolve(reason ? { reason } : {}) }));
}

describe('SsoErrorPage', () => {
  afterEach(cleanup);

  it('explains an unverified Vercel email and how to fix it', async () => {
    await renderFor('email_unverified');
    expect(
      screen.getByRole('heading', { level: 1, name: /email address is not verified/i }),
    ).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Back to Vercel' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Contact support' }).getAttribute('href')).toBe(
      '/?subject=technical#contact',
    );
  });

  it('falls back to a generic message for an unknown or crafted reason', async () => {
    await renderFor('<script>alert(1)</script>');
    expect(screen.getByRole('heading', { level: 1, name: /could not sign you in/i })).toBeTruthy();
  });

  it('is never indexed', () => {
    expect(metadata.robots).toEqual({ index: false, follow: false });
  });
});
