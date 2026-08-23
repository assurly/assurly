'use client';

import type { ReactElement } from 'react';
import { MCP_NAV_LINKS } from '../../_components/home/HomeHeader';
import { SiteNavHeader } from '../../_components/home/SiteNavHeader';

interface McpHeaderProps {
  authenticated: boolean;
  loginUrl: string;
}

/**
 * Landing nav chrome with MCP Server marked current. Drawer behaviour lives
 * in `SiteNavHeader` (hamburger ≤1100px, `/#…` product links).
 */
export function McpHeader({ authenticated, loginUrl }: McpHeaderProps): ReactElement {
  return (
    <SiteNavHeader authenticated={authenticated} loginUrl={loginUrl} navLinks={MCP_NAV_LINKS} />
  );
}
