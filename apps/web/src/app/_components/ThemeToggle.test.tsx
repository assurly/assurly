// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ThemeProvider } from './ThemeProvider';
import { ThemeToggle } from './ThemeToggle';
import { THEME_STORAGE_KEY } from '../../utils/theme';

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
      matches: false,
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
  document.documentElement.removeAttribute('data-theme');
  document.documentElement.removeAttribute('data-theme-preference');
});

describe('ThemeToggle', () => {
  it('exposes System, Light, and Dark as a named radiogroup', () => {
    render(
      <ThemeProvider>
        <ThemeToggle />
      </ThemeProvider>,
    );

    expect(screen.getByRole('group', { name: 'Color theme' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'System' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Light' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Dark' })).toBeTruthy();
  });

  it('persists Light and sets data-theme on the document', () => {
    render(
      <ThemeProvider>
        <ThemeToggle />
      </ThemeProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Light' }));

    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('light');
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(document.documentElement.dataset.themePreference).toBe('light');
    expect(screen.getByRole('button', { name: 'Light' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('persists Dark independently of the OS preference', () => {
    render(
      <ThemeProvider>
        <ThemeToggle />
      </ThemeProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Dark' }));

    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(screen.getByRole('button', { name: 'Dark' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('keeps header labels accessible without painting them in chrome', () => {
    render(
      <ThemeProvider>
        <ThemeToggle />
      </ThemeProvider>,
    );

    const light = screen.getByRole('button', { name: 'Light' });
    expect(light.querySelector('.theme-toggle__label')?.classList.contains('visually-hidden')).toBe(
      true,
    );
  });

  it('shows labels in the sheet variant', () => {
    render(
      <ThemeProvider>
        <ThemeToggle variant="sheet" />
      </ThemeProvider>,
    );

    const light = screen.getByRole('button', { name: 'Light' });
    expect(light.querySelector('.theme-toggle__label')?.classList.contains('visually-hidden')).toBe(
      false,
    );
    expect(light.textContent).toContain('Light');
  });
});
