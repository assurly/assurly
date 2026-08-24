import { describe, expect, it } from 'vitest';
import { SITE_ORIGIN, publicPageUrl } from './siteMetadata';

describe('publicPageUrl', () => {
  it('keeps a trailing slash on the homepage and nowhere else', () => {
    expect(publicPageUrl(SITE_ORIGIN, '/')).toBe('https://assurly.dev/');
    expect(publicPageUrl(SITE_ORIGIN, '/mcp')).toBe('https://assurly.dev/mcp');
    expect(publicPageUrl(SITE_ORIGIN, '/sitemap.xml')).toBe('https://assurly.dev/sitemap.xml');
  });

  it('accepts an origin that already has a trailing slash', () => {
    expect(publicPageUrl('https://assurly.dev/', '/')).toBe('https://assurly.dev/');
    expect(publicPageUrl('https://assurly.dev/', '/privacy')).toBe('https://assurly.dev/privacy');
  });

  it('preserves in-page hashes used by structured data', () => {
    expect(publicPageUrl(SITE_ORIGIN, '/#pricing')).toBe('https://assurly.dev/#pricing');
  });
});
