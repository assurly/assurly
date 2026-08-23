'use client';

import { useEffect, useState, type ReactElement } from 'react';
import { HomeHeader, MARKETING_NAV_LINKS, type SiteNavLink } from './HomeHeader';

interface SiteNavHeaderProps {
  authenticated: boolean;
  loginUrl: string;
  navLinks?: readonly SiteNavLink[];
}

/**
 * Landing primary-nav chrome for product pages: hamburger drawer ≤1100px,
 * focus trap / Escape / outside-close via `useAccessibleMenu`, and body
 * `menu-open` scroll lock. Theme toggle lives in the overlay on mobile.
 */
export function SiteNavHeader({
  authenticated,
  loginUrl,
  navLinks = MARKETING_NAV_LINKS,
}: SiteNavHeaderProps): ReactElement {
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    if (menuOpen) {
      document.body.classList.add('menu-open');
    } else {
      document.body.classList.remove('menu-open');
    }
    return () => {
      document.body.classList.remove('menu-open');
    };
  }, [menuOpen]);

  return (
    <HomeHeader
      authenticated={authenticated}
      loginUrl={loginUrl}
      menuOpen={menuOpen}
      onMenuChange={setMenuOpen}
      navLinks={navLinks}
      logoHref="/"
    />
  );
}
