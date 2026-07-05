// @vitest-environment jsdom

import { act } from 'react';
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

    // hydrateRoot schedules React's concurrent-mode work asynchronously (via
    // the internal scheduler). Wrapping in act() flushes that work
    // synchronously so hydration is actually complete before this test ends
    // — unmounting (or the next test file's jsdom teardown) before that
    // point previously surfaced as an intermittent unhandled exception from
    // a scheduler task firing against a torn-down `window`.
    let root: ReturnType<typeof hydrateRoot> | undefined;
    try {
      act(() => {
        root = hydrateRoot(container, <HomeClient {...props} />);
      });
    } finally {
      console.error = originalConsoleError;
    }

    act(() => {
      root?.unmount();
    });

    expect(hydrationErrors).toEqual([]);
  });
});
