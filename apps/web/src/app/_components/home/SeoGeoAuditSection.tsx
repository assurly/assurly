import React from 'react';

/**
 * Marketing explanation for the SEO & GEO Audit.
 *
 * Claims here must stay checkable against what ships (see ProofPoints.tsx).
 * Named checks are the ones `scanVisibility` actually runs — guarded by
 * SeoGeoAuditSection.test.tsx against the visibilityScan source.
 */

/** Check titles named on the marketing page — must exist in visibilityScan.ts. */
export const SEO_GEO_NAMED_CHECKS = [
  'canonical',
  'structured data',
  'llms.txt',
  'server-rendered content',
  'AI crawler access',
  'share images',
] as const;

export function SeoGeoAuditSection(): React.ReactElement {
  return (
    <section
      id="seo-geo-audit"
      className="seo-geo-section"
      aria-labelledby="seo-geo-heading"
      data-testid="seo-geo-audit-section"
    >
      <div className="seo-geo-header">
        <p className="seo-geo-eyebrow">SEO &amp; GEO Audit</p>
        <h2 id="seo-geo-heading">Your app can look fine and still be invisible to AI</h2>
        <p className="seo-geo-lead">
          AI coding tools often ship sites whose HTML is little more than an empty root element. The
          page looks complete in a browser. ChatGPT, Perplexity, and Google&apos;s AI answers fetch
          that same HTML and find almost nothing they can read.
        </p>
      </div>

      <div className="seo-geo-grid">
        <article className="seo-geo-card">
          <h3 className="seo-geo-card-title">What the audit scores</h3>
          <p className="seo-geo-card-body">
            Paste a live URL in the scanner above. Alongside the Ship Gate security verdict, Assurly
            returns an AI Readiness Score out of 100 with a separate machine-readability verdict —
            FULLY VISIBLE, PARTIALLY VISIBLE, or INVISIBLE TO AI. That score is not a ChatGPT or
            Perplexity ranking; Assurly does not query those engines. It reads your page the way a
            crawler would.
          </p>
        </article>

        <article className="seo-geo-card">
          <h3 className="seo-geo-card-title">Concrete checks</h3>
          <p className="seo-geo-card-body">
            The audit looks at canonical URLs, structured data (JSON-LD), llms.txt, server-rendered
            content, AI crawler access in robots.txt, and share images (og:image), plus related
            readiness signals such as title, meta description, and a single H1.
          </p>
        </article>

        <article className="seo-geo-card">
          <h3 className="seo-geo-card-title">Scores first, fixes behind sign-in</h3>
          <p className="seo-geo-card-body">
            Anonymous visitors see the headline scores and verdict immediately. Signing in on Pro
            unlocks every check and the exact fix for each gap — the same paywall the dashboard
            uses, not a CSS hide.
          </p>
        </article>
      </div>
    </section>
  );
}
