'use client';

import { useCallback, type ReactElement } from 'react';
import { AuthButton } from './AuthButton';
import { useAccessibleMenu } from '../../../hooks/useAccessibleMenu';

interface HomeHeaderProps {
  authenticated: boolean;
  loginUrl: string;
  menuOpen: boolean;
  onMenuChange: (open: boolean) => void;
}

const NAV_LINKS = [
  { href: '#features', label: 'Features' },
  { href: '#pricing', label: 'Pricing' },
  { href: '#contact', label: 'Contact' },
] as const;

const HEADER_AUTH_LABELS = {
  signIn: 'Sign In',
  dashboard: 'Go to Dashboard',
} as const;

function joinClasses(...classes: Array<string | false | null | undefined>): string | undefined {
  const value = classes.filter(Boolean).join(' ');
  return value.length > 0 ? value : undefined;
}

export function HomeHeader({
  authenticated,
  loginUrl,
  menuOpen,
  onMenuChange,
}: HomeHeaderProps): ReactElement {
  const closeMenu = useCallback((): void => {
    onMenuChange(false);
  }, [onMenuChange]);

  const toggleMenu = useCallback((): void => {
    onMenuChange(!menuOpen);
  }, [menuOpen, onMenuChange]);

  const { menuRef, rememberTrigger } = useAccessibleMenu<HTMLElement>({
    open: menuOpen,
    onClose: closeMenu,
    trapAt: '(max-width: 768px)',
  });

  const handleMenuToggle = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>): void => {
      rememberTrigger(event.currentTarget);
      toggleMenu();
    },
    [rememberTrigger, toggleMenu],
  );

  return (
    <header className={joinClasses(menuOpen && 'site-header-menu-open')}>
      <div className="container nav-container">
        <div className="logo" id="header-logo">
          📦 Ship<span>Ready</span>
        </div>
        <button
          type="button"
          className="hamburger-btn"
          onClick={handleMenuToggle}
          aria-label={menuOpen ? 'Close navigation' : 'Open navigation'}
          aria-expanded={menuOpen}
          aria-controls="primary-navigation"
        >
          {[0, 1, 2].map((bar) => (
            <span key={bar} className={joinClasses('bar', menuOpen && 'open')} aria-hidden="true" />
          ))}
        </button>
        <nav
          id="primary-navigation"
          ref={menuRef}
          className={joinClasses(menuOpen && 'open')}
          aria-label="Primary navigation"
        >
          {NAV_LINKS.map((link) => (
            <a key={link.href} href={link.href} onClick={closeMenu}>
              {link.label}
            </a>
          ))}
          <AuthButton
            authenticated={authenticated}
            variant="primary"
            labels={HEADER_AUTH_LABELS}
            loginUrl={loginUrl}
            onNavigate={closeMenu}
          />
        </nav>
      </div>
    </header>
  );
}
