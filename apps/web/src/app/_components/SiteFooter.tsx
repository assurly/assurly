import type { ReactElement } from 'react';
import Link from 'next/link';
import { AssurlyMark } from './AssurlyMark';

type SiteFooterProps = { variant: 'full' | 'compact' };

type FooterNavLink = { readonly href: string; readonly label: string };

/** Single source of truth for legal footer links. Swap Cookies to `/cookies` when that page ships. */
const LEGAL_LINKS = [
  { href: '/privacy', label: 'Privacy Policy' },
  { href: '/privacy#cookies', label: 'Cookies' },
  { href: '/terms', label: 'Terms of Service' },
] as const satisfies readonly FooterNavLink[];

/** Full footer Legal column — Trust is compliance, not a product feature; keep out of compact. */
const FULL_LEGAL_LINKS = [...LEGAL_LINKS, { href: '/trust', label: 'Trust' }] as const;

const PRODUCT_LINKS = [
  { href: '/#features', label: 'Features' },
  { href: '/#pricing', label: 'Pricing' },
  { href: '/mcp', label: 'MCP Server' },
] as const satisfies readonly FooterNavLink[];

const RESOURCE_LINKS = [
  { href: '/#contact', label: 'Contact', external: false },
  {
    href: 'https://github.com/assurly/assurly',
    label: 'GitHub',
    external: true,
  },
  {
    href: 'https://www.npmjs.com/package/assurly',
    label: 'npm — assurly',
    external: true,
  },
] as const;

const COPYRIGHT = '© 2026 Assurly. All rights reserved.';
const PRODUCT_DESCRIPTOR = 'Know what will break in production — before you deploy.';

function LegalLinkList({
  className,
  links,
}: {
  className: string;
  links: readonly FooterNavLink[];
}): ReactElement {
  return (
    <ul className={className}>
      {links.map((link) => (
        <li key={link.href}>
          <Link href={link.href}>{link.label}</Link>
        </li>
      ))}
    </ul>
  );
}

function FullFooter(): ReactElement {
  return (
    <footer className="site-footer site-footer--full" aria-label="Assurly site footer">
      <div className="container site-footer__inner">
        <div className="site-footer__grid">
          <div className="site-footer__brand">
            <Link href="/" className="site-footer__brand-link">
              <AssurlyMark className="site-logo-mark" />
              <span className="site-footer__wordmark">
                Ass<span>url</span>y
              </span>
            </Link>
            <p className="site-footer__descriptor">{PRODUCT_DESCRIPTOR}</p>
            <p className="site-footer__copyright">{COPYRIGHT}</p>
          </div>

          <nav className="site-footer__column" aria-label="Product">
            <h2 className="site-footer__heading">Product</h2>
            <ul className="site-footer__list">
              {PRODUCT_LINKS.map((link) => (
                <li key={link.href}>
                  <Link href={link.href}>{link.label}</Link>
                </li>
              ))}
            </ul>
          </nav>

          <nav className="site-footer__column" aria-label="Legal">
            <h2 className="site-footer__heading">Legal</h2>
            <LegalLinkList className="site-footer__list" links={FULL_LEGAL_LINKS} />
          </nav>

          <nav className="site-footer__column" aria-label="Resources">
            <h2 className="site-footer__heading">Resources</h2>
            <ul className="site-footer__list">
              {RESOURCE_LINKS.map((link) => (
                <li key={link.href}>
                  {link.external ? (
                    <a href={link.href} target="_blank" rel="noopener noreferrer">
                      {link.label}
                    </a>
                  ) : (
                    <Link href={link.href}>{link.label}</Link>
                  )}
                </li>
              ))}
            </ul>
          </nav>
        </div>
      </div>
    </footer>
  );
}

function CompactFooter(): ReactElement {
  const compactLinks = [
    ...LEGAL_LINKS.map((link) => ({ href: link.href, label: link.label })),
    { href: '/#contact', label: 'Contact' },
  ];

  return (
    <footer className="site-footer site-footer--compact" aria-label="Assurly dashboard footer">
      <div className="site-footer__compact-inner">
        <p className="site-footer__compact-copy">{COPYRIGHT}</p>
        <nav className="site-footer__compact-nav" aria-label="Legal and contact">
          <ul className="site-footer__compact-list">
            {compactLinks.map((link) => (
              <li key={link.href}>
                <Link href={link.href}>{link.label}</Link>
              </li>
            ))}
          </ul>
        </nav>
      </div>
    </footer>
  );
}

export function SiteFooter({ variant }: SiteFooterProps): ReactElement {
  switch (variant) {
    case 'full':
      return <FullFooter />;
    case 'compact':
      return <CompactFooter />;
    default: {
      const _exhaustive: never = variant;
      return _exhaustive;
    }
  }
}
