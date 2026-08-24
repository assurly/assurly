/**
 * The canonical public origin, used to mint `@id` anchors for structured data.
 *
 * Deliberately a constant rather than `getApplicationUrl()`. A schema `@id` is a
 * stable identifier for an entity, not a location: the Organization described on
 * a Vercel preview deployment is the same organization as the one on production,
 * and reading the environment would mint a different identity per deployment.
 * Two `@id`s for one entity is precisely the ambiguity structured data exists to
 * remove.
 */
export const SITE_ORIGIN = 'https://assurly.dev';

/**
 * Absolute URL for a public page.
 *
 * Homepage keeps the trailing slash — that is the origin form schema.org,
 * sitemaps, and Google treat as the URL of `/`. Every other path is
 * slash-free, matching Next's default routing (`trailingSlash: false`).
 *
 * `origin` is typically `getApplicationUrl()` (sitemap, canonical, robots)
 * or `SITE_ORIGIN` (stable JSON-LD `@id`s). Passing either with or without
 * a trailing slash is fine.
 */
export function publicPageUrl(origin: string, path: string): string {
  const base = new URL(origin).origin;
  return path === '/' ? `${base}/` : new URL(path, `${base}/`).href.replace(/\/$/, '');
}

/**
 * Shared Open Graph image descriptor.
 *
 * `app/opengraph-image.tsx` only reaches a route that does not declare its own
 * `openGraph` object. Next merges metadata shallowly, so a page setting
 * `openGraph` replaces the parent's entire object — including the images the
 * file convention put there. Every page that overrides `openGraph` therefore has
 * to restate the image, and it should restate the same one.
 *
 * /mcp had shipped without a share image for exactly this reason: linked in a
 * chat or on social it rendered as a bare text card.
 */
export const SITE_OG_IMAGE = {
  url: '/opengraph-image',
  width: 1200,
  height: 630,
  alt: 'Assurly — Pre-deploy Ship Gate for AI-built SaaS',
} as const;
