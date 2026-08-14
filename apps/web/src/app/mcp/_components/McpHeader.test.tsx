// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { McpHeader } from './McpHeader';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
}));

afterEach(() => {
  cleanup();
  document.body.classList.remove('menu-open');
});

describe('McpHeader', () => {
  it('exposes the same hamburger + primary navigation contract as the landing header', () => {
    render(<McpHeader authenticated={false} loginUrl="/api/auth/login" />);

    const toggle = screen.getByRole('button', { name: 'Open navigation' });
    expect(toggle.getAttribute('aria-controls')).toBe('primary-navigation');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(screen.getByRole('navigation', { name: 'Primary navigation' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Assurly' }).getAttribute('href')).toBe('/');
    expect(screen.getByRole('link', { name: 'MCP Server' }).getAttribute('aria-current')).toBe(
      'page',
    );
    expect(screen.getByRole('link', { name: 'FAQ' }).getAttribute('href')).toBe('/#faq');
    expect(screen.getByRole('link', { name: 'Sign In' }).getAttribute('href')).toBe(
      '/api/auth/login',
    );
  });

  it('toggles the drawer and locks body scroll like the landing page', () => {
    render(<McpHeader authenticated={false} loginUrl="/api/auth/login" />);

    const toggle = screen.getByRole('button', { name: 'Open navigation' });
    fireEvent.click(toggle);

    expect(
      screen.getByRole('button', { name: 'Close navigation' }).getAttribute('aria-expanded'),
    ).toBe('true');
    expect(document.getElementById('primary-navigation')?.classList.contains('open')).toBe(true);
    expect(document.body.classList.contains('menu-open')).toBe(true);

    fireEvent.click(screen.getByRole('link', { name: 'Features' }));
    expect(document.body.classList.contains('menu-open')).toBe(false);
    expect(document.getElementById('primary-navigation')?.classList.contains('open')).toBe(false);
  });
});
