// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import DashboardClient from './_components/DashboardClient';
import * as clientApiModule from '../../utils/clientApi';

const { clientApi, ClientApiError } = clientApiModule;
type SessionResult = clientApiModule.SessionResult;

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('./_components/manual-checker/ManualChecker', () => ({
  default: () => null,
}));

// Keep ClientApiError (and every other export) real so `error instanceof
// ClientApiError` inside the component still resolves the genuine class; only
// the `portal` network call is replaced with a spy.
vi.mock('../../utils/clientApi', async (importOriginal) => {
  const actual = (await importOriginal()) as typeof clientApiModule;
  return {
    ...actual,
    clientApi: {
      ...actual.clientApi,
      targets: vi.fn(async () => ({ targets: [] })),
      portal: vi.fn(),
    },
  };
});

const PORTAL_URL = 'https://billing.stripe.com/p/session/test';

const proSession: SessionResult = {
  user: { id: 'user-1', name: 'Pro User', email: 'pro@example.com', avatar_url: '' },
  organization: {
    id: 'org-1',
    name: 'Acme',
    billing_plan: 'pro',
    stripe_customer_id: 'cus_test',
    created_at: '2026-06-21T00:00:00Z',
  },
  repositories: [],
};

const portalMock = vi.mocked(clientApi.portal);
const assignMock = vi.fn();
const originalLocation = window.location;

const ACCOUNT_MENU_TRIGGER = 'Open account menu for Pro User';

function openManageBilling(): void {
  fireEvent.click(screen.getByRole('button', { name: ACCOUNT_MENU_TRIGGER }));
  fireEvent.click(screen.getByRole('button', { name: /manage billing/i }));
}

beforeEach(() => {
  portalMock.mockReset();
  assignMock.mockReset();

  // jsdom's localStorage is not reliably initialized; a mount effect reads it.
  const store = new Map<string, string>();
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
      setItem: (key: string, value: string) => void store.set(key, String(value)),
      removeItem: (key: string) => void store.delete(key),
      clear: () => store.clear(),
      key: (index: number) => Array.from(store.keys())[index] ?? null,
      get length() {
        return store.size;
      },
    },
  });

  // jsdom does not implement matchMedia; the account menu's focus-trap hook
  // queries it the moment the menu opens.
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })) as unknown as typeof window.matchMedia;

  // jsdom's location.assign is non-configurable and throws on real navigation,
  // so swap window.location for a stub we can assert against.
  Reflect.deleteProperty(window, 'location');
  (window as { location: Location }).location = {
    href: 'http://localhost/dashboard',
    origin: 'http://localhost',
    pathname: '/dashboard',
    search: '',
    hash: '',
    assign: assignMock,
    replace: vi.fn(),
    reload: vi.fn(),
  } as unknown as Location;
});

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(window, 'location');
  (window as { location: Location }).location = originalLocation;
});

describe('Manage Billing button (regression for silent router.push redirect)', () => {
  it('redirects to the external Stripe portal via a full navigation on success', async () => {
    portalMock.mockResolvedValue({ url: PORTAL_URL });

    render(<DashboardClient initialSession={proSession} />);
    openManageBilling();

    await waitFor(() => expect(portalMock).toHaveBeenCalledTimes(1));
    // The original bug used router.push() (client-side, internal routes only),
    // which silently dropped this external URL. A full-page assign is required.
    await waitFor(() => expect(assignMock).toHaveBeenCalledWith(PORTAL_URL));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('surfaces an actionable error toast and stays put when the request fails', async () => {
    portalMock.mockRejectedValue(
      new ClientApiError('Billing account not found.', 404, 'not_found'),
    );

    render(<DashboardClient initialSession={proSession} />);
    openManageBilling();

    // The original bug only did console.error(); the user must now see the error.
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Billing account not found.');
    expect(assignMock).not.toHaveBeenCalled();
  });

  it('falls back to a generic message for non-API failures', async () => {
    portalMock.mockRejectedValue(new Error('network down'));

    render(<DashboardClient initialSession={proSession} />);
    openManageBilling();

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Billing management is temporarily unavailable');
    expect(assignMock).not.toHaveBeenCalled();
  });
});
