'use client';

import Link from 'next/link';
import { useCallback, useEffect, type ReactElement } from 'react';
import { AuthButton } from './AuthButton';
import { AssurlyMark } from '../AssurlyMark';
import { AssurlyWordmark } from '../AssurlyWordmark';
import { ThemeToggle } from '../ThemeToggle';
import { useAccessibleMenu } from '../../../hooks/useAccessibleMenu';

/** Keep in sync with `.site-header` overlay in `globals.css`. */
export const LANDING_NAV_OVERLAY_MQ = '(max-width: 1100px)';

export interface SiteNavLink {
  href: string;
  label: string;
  /** Marks the active page in the primary nav (`aria-current="page"`). */
  current?: boolean;
}

interface HomeHeaderProps {
  authenticated: boolean;
  loginUrl: string;
  menuOpen: boolean;
  onMenuChange: (open: boolean) => void;
  /** Override landing anchors when reused on product pages (e.g. `/mcp`). */
  navLinks?: readonly SiteNavLink[];
  /** When set, the brand mark links home (product pages). Landing keeps a static mark. */
  logoHref?: string;
}

export const LANDING_NAV_LINKS: readonly SiteNavLink[] = [
  { href: '#features', label: 'Features' },
  { href: '#pricing', label: 'Pricing' },
  { href: '/mcp', label: 'MCP Server' },
  { href: '#faq', label: 'FAQ' },
  { href: '#contact', label: 'Contact' },
];

export const MCP_NAV_LINKS: readonly SiteNavLink[] = [
  { href: '/#features', label: 'Features' },
  { href: '/#pricing', label: 'Pricing' },
  { href: '/mcp', label: 'MCP Server', current: true },
  { href: '/#faq', label: 'FAQ' },
  { href: '/#contact', label: 'Contact' },
];

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
  navLinks = LANDING_NAV_LINKS,
  logoHref,
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
    trapAt: LANDING_NAV_OVERLAY_MQ,
  });

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const media = window.matchMedia(LANDING_NAV_OVERLAY_MQ);
    const onChange = (): void => {
      if (!media.matches) closeMenu();
    };
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, [closeMenu]);

  const handleMenuToggle = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>): void => {
      rememberTrigger(event.currentTarget);
      toggleMenu();
    },
    [rememberTrigger, toggleMenu],
  );

  const brand = (
    <>
      <AssurlyMark className="site-logo-mark" />
      <AssurlyWordmark accentClassName="site-logo-accent" />
    </>
  );

  return (
    <header className={joinClasses('site-header', menuOpen && 'site-header-menu-open')}>
      <div className="container nav-container">
        {logoHref ? (
          <Link href={logoHref} className="logo" id="header-logo" aria-label="Assurly">
            {brand}
          </Link>
        ) : (
          <div className="logo" id="header-logo" role="img" aria-label="Assurly">
            {brand}
          </div>
        )}
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
          {navLinks.map((link) => (
            <a
              key={link.href}
              href={link.href}
              onClick={closeMenu}
              {...(link.current ? { 'aria-current': 'page' as const } : {})}
            >
              {link.label}
            </a>
          ))}
          <div className="header-toolbar">
            <ThemeToggle />
            <AuthButton
              authenticated={authenticated}
              variant="primary"
              labels={HEADER_AUTH_LABELS}
              loginUrl={loginUrl}
              onNavigate={closeMenu}
            />
          </div>
        </nav>
      </div>
    </header>
  );
}
