// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { AuthButton } from './AuthButton';
import { consumeDashboardSplashRequest } from '../../../utils/splashSignal';

const push = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace: vi.fn(), prefetch: vi.fn() }),
}));

const baseProps = {
  variant: 'primary' as const,
  labels: { signIn: 'Sign In', dashboard: 'Go to Dashboard' },
  loginUrl: '/api/auth/login',
  onNavigate: vi.fn(),
};

afterEach(() => {
  cleanup();
  push.mockClear();
  window.sessionStorage.clear();
});

describe('AuthButton — dashboard splash signal', () => {
  it('requests the splash and client-navigates when an authenticated user enters the dashboard', () => {
    render(<AuthButton {...baseProps} authenticated />);

    fireEvent.click(screen.getByText('Go to Dashboard'), { button: 0 });

    expect(push).toHaveBeenCalledWith('/dashboard');
    expect(consumeDashboardSplashRequest()).toBe(true);
  });

  it('does not request the splash for the anonymous sign-in path', () => {
    render(<AuthButton {...baseProps} authenticated={false} />);

    const link = screen.getByText('Sign In');
    // The anonymous path intentionally allows native full-page navigation; block
    // it here so jsdom does not emit its "navigation not implemented" notice.
    link.addEventListener('click', (event) => event.preventDefault());
    fireEvent.click(link, { button: 0 });

    expect(push).not.toHaveBeenCalled();
    expect(consumeDashboardSplashRequest()).toBe(false);
  });
});
