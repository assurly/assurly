// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { hydrateRoot } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ThemeProvider, useTheme } from './ThemeProvider';
import { THEME_STORAGE_KEY } from '../../utils/theme';
import type { ReactElement } from 'react';

function Probe(): ReactElement {
  const { preference, resolved } = useTheme();
  return <span data-testid="theme-probe">{`${preference}:${resolved}`}</span>;
}

function collectHydrationErrors(run: () => void): string[] {
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
    run();
  } finally {
    console.error = originalConsoleError;
  }
  return hydrationErrors;
}

const memoryStore = new Map<string, string>();

beforeEach(() => {
  memoryStore.clear();
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string): string | null => memoryStore.get(key) ?? null,
      setItem: (key: string, value: string): void => {
        memoryStore.set(key, value);
      },
      removeItem: (key: string): void => {
        memoryStore.delete(key);
      },
    },
  });
  window.matchMedia = (query: string): MediaQueryList =>
    ({
      matches: query.includes('prefers-color-scheme: light'),
      media: query,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false,
    }) as MediaQueryList;
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = '';
  document.documentElement.removeAttribute('data-theme');
  document.documentElement.removeAttribute('data-theme-preference');
});

describe('ThemeProvider', () => {
  it('paints system:dark on the server without reading window', () => {
    const html = renderToString(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    expect(html).toContain('system:dark');
  });

  it('hydrates without a mismatch when the OS prefers light', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const markup = renderToString(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    container.innerHTML = markup;

    const hydrationErrors = collectHydrationErrors(() => {
      hydrateRoot(
        container,
        <ThemeProvider>
          <Probe />
        </ThemeProvider>,
      );
    });

    expect(hydrationErrors).toEqual([]);
  });

  it('applies a stored Light preference after mount', () => {
    memoryStore.set(THEME_STORAGE_KEY, 'light');
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    expect(screen.getByTestId('theme-probe').textContent).toBe('light:light');
    expect(document.documentElement.dataset.theme).toBe('light');
  });
});
