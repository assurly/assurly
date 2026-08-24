import type { MetadataRoute } from 'next';
import { getApplicationUrl } from '../utils/env';
import { publicPageUrl } from '../utils/siteMetadata';

/** Public, indexable pages only — nothing under /dashboard or /report belongs here. */
const PUBLIC_PATHS = [
  { path: '/', priority: 1, changeFrequency: 'weekly' as const },
  { path: '/mcp', priority: 0.8, changeFrequency: 'weekly' as const },
  { path: '/trust', priority: 0.6, changeFrequency: 'monthly' as const },
  { path: '/privacy', priority: 0.3, changeFrequency: 'yearly' as const },
  { path: '/terms', priority: 0.3, changeFrequency: 'yearly' as const },
];

export default function sitemap(): MetadataRoute.Sitemap {
  const origin = getApplicationUrl();
  const lastModified = new Date();

  return PUBLIC_PATHS.map(({ path, priority, changeFrequency }) => ({
    url: publicPageUrl(origin, path),
    lastModified,
    changeFrequency,
    priority,
  }));
}
