'use client';

import { useEffect, useState, type ReactElement } from 'react';
import { HomeHeader, MCP_NAV_LINKS } from '../../_components/home/HomeHeader';

interface McpHeaderProps {
  authenticated: boolean;
  loginUrl: string;
}

/**
 * Same primary-nav contract as the landing header: hamburger drawer ≤768px,
 * focus trap / Escape / outside-close via `useAccessibleMenu`, and body
 * `menu-open` scroll lock. Product-page links use `/#…` anchors back home.
 */
export function McpHeader({ authenticated, loginUrl }: McpHeaderProps): ReactElement {
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
      navLinks={MCP_NAV_LINKS}
      logoHref="/"
    />
  );
}
