// @vitest-environment jsdom

import { hydrateRoot } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import HomeClient from './HomeClient';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/',
}));

describe('HomeClient — hydration contract', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('hydrates anonymous landing markup without React hydration warnings', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);

    const props = {
      initialAuthenticated: false,
      loginUrl: 'http://localhost:3000/api/auth/login',
    } as const;

    const markup = renderToString(<HomeClient {...props} />);
    container.innerHTML = markup;

    const hydrationErrors: string[] = [];
    const originalConsoleError = console.error;
    console.error = (...args: unknown[]) => {
      const message = args.map(String).join(' ');
      if (/hydration|did not match/i.test(message)) {
        hydrationErrors.push(message);
      }
      originalConsoleError(...args);
    };

    try {
      hydrateRoot(container, <HomeClient {...props} />);
    } finally {
      console.error = originalConsoleError;
    }

    expect(hydrationErrors).toEqual([]);
  });
});
