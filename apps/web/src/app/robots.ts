import type { MetadataRoute } from 'next';
import { getApplicationUrl } from '../utils/env';

/**
 * Crawl policy. The marketing pages are open; everything that belongs to a customer is
 * closed. `/report/` matters most: those pages are reachable by token by design, but they
 * name a repository and list its unfixed findings, so they must never enter a search index
 * (the pages also carry their own `noindex`, this is the belt to that pair of braces).
 */
export default function robots(): MetadataRoute.Robots {
  const baseUrl = getApplicationUrl().replace(/\/$/, '');

  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: ['/api/', '/dashboard', '/report/'],
      },
    ],
    sitemap: `${baseUrl}/sitemap.xml`,
  };
}
