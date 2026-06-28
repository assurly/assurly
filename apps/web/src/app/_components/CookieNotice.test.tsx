// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { CookieNotice } from './CookieNotice';
import { COOKIE_NOTICE_STORAGE_KEY } from '../../utils/cookieNoticeStorage';
import { COOKIE_POLICY_VERSION } from '../../utils/cookieInventory';

function createLocalStorageMock(): Storage {
  const store = new Map<string, string>();

  return {
    get length() {
      return store.size;
    },
    clear() {
      store.clear();
    },
    getItem(key: string) {
      return store.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      store.set(key, value);
    },
    removeItem(key: string) {
      store.delete(key);
    },
    key(index: number) {
      return [...store.keys()][index] ?? null;
    },
  };
}

describe('CookieNotice', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      value: createLocalStorageMock(),
    });
  });

  afterEach(() => {
    cleanup();
  });

  it('shows the informational notice until dismissed', async () => {
    render(<CookieNotice />);

    await waitFor(() => {
      expect(screen.getByTestId('cookie-notice')).toBeTruthy();
    });

    expect(screen.getByText(/Essential cookies only/i)).toBeTruthy();
    expect(screen.getByRole('link', { name: /Cookie details/i }).getAttribute('href')).toBe(
      '/privacy#cookies',
    );
  });

  it('persists dismissal for the current policy version', async () => {
    render(<CookieNotice />);

    await waitFor(() => {
      expect(screen.getByTestId('cookie-notice')).toBeTruthy();
    });

    fireEvent.click(screen.getByRole('button', { name: /Got it/i }));

    await waitFor(() => {
      expect(screen.queryByTestId('cookie-notice')).toBeNull();
    });

    const stored = JSON.parse(window.localStorage.getItem(COOKIE_NOTICE_STORAGE_KEY) ?? '{}') as {
      version?: string;
    };
    expect(stored.version).toBe(COOKIE_POLICY_VERSION);
  });
});
