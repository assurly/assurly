// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAccessibleMenu } from './useAccessibleMenu';

function MobileMenuHarness({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}): React.ReactElement {
  const { menuRef, rememberTrigger } = useAccessibleMenu<HTMLElement>({
    open,
    onClose,
    trapAt: '(max-width: 768px)',
  });

  return (
    <div>
      <div id="header-logo">ShipReady</div>
      <button
        type="button"
        className="hamburger-btn"
        ref={(node) => {
          if (node) rememberTrigger(node);
        }}
        onClick={(event) => rememberTrigger(event.currentTarget)}
      >
        Menu
      </button>
      <nav id="primary-navigation" ref={menuRef}>
        <a href="#features">Features</a>
        <div data-testid="menu-spacer" style={{ flex: 1, minHeight: 120 }} />
      </nav>
      <main>Page content</main>
    </div>
  );
}

describe('useAccessibleMenu', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: query.includes('max-width'),
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });
  });

  afterEach(() => {
    cleanup();
  });

  it('closes the menu when the user taps outside the drawer on mobile', () => {
    const onClose = vi.fn();
    render(<MobileMenuHarness open onClose={onClose} />);

    fireEvent.pointerDown(screen.getByText('Page content'));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes the menu when the user taps empty overlay space inside the drawer', () => {
    const onClose = vi.fn();
    render(<MobileMenuHarness open onClose={onClose} />);

    fireEvent.pointerDown(screen.getByRole('navigation'));
    fireEvent.pointerDown(screen.getByTestId('menu-spacer'));

    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('does not close when tapping a menu link or the trigger button', () => {
    const onClose = vi.fn();
    render(<MobileMenuHarness open onClose={onClose} />);

    fireEvent.pointerDown(screen.getByRole('link', { name: 'Features' }));
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Menu' }));

    expect(onClose).not.toHaveBeenCalled();
  });
});
