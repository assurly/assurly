// Runs in the default node environment: renderToStaticMarkup needs no DOM,
// and under a browser-like environment `import.meta.url` becomes an http URL
// that readFileSync cannot resolve.
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { SEO_GEO_NAMED_CHECKS, SeoGeoAuditSection } from './SeoGeoAuditSection';

function render(): string {
  return renderToStaticMarkup(<SeoGeoAuditSection />);
}

function sourceOf(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), 'utf8');
}

/**
 * Titles and id fragments that actually ship in visibilityScan.ts — the
 * marketing copy may only name checks that exist there.
 */
function shippedVisibilitySignals(): string {
  return sourceOf('../../../utils/visibilityScan.ts');
}

describe('SeoGeoAuditSection', () => {
  it('renders a real heading in the document outline', () => {
    const html = render();
    expect(html).toContain('id="seo-geo-heading"');
    expect(html).toContain('aria-labelledby="seo-geo-heading"');
    expect(html).toMatch(/<h2[^>]*id="seo-geo-heading"/);
  });

  it('leads with the empty-root / AI-invisible problem, not adjectives', () => {
    const html = render();
    expect(html).toMatch(/empty root element/i);
    expect(html).toMatch(/ChatGPT/);
    expect(html).toMatch(/Perplexity/);
    expect(html).not.toMatch(/trusted by/i);
    expect(html).not.toMatch(/\d+%/);
    expect(html).not.toMatch(/ChatGPT ranking/i);
  });

  it('names only checks that visibilityScan actually runs', () => {
    const html = render();
    const source = shippedVisibilitySignals();

    for (const named of SEO_GEO_NAMED_CHECKS) {
      expect(html.toLowerCase(), `marketing names "${named}"`).toContain(named.toLowerCase());
    }

    // Concrete anchors in the scanner source — copy drift fails here.
    expect(source).toContain("id: 'seo-canonical'");
    expect(source).toContain("id: 'ai-structured-data'");
    expect(source).toContain("id: 'ai-llms-txt'");
    expect(source).toContain("id: 'ai-ssr-content'");
    expect(source).toContain("id: 'ai-crawler-access'");
    expect(source).toContain("id: 'seo-og-image'");
  });

  it('does not invent a metric count that is not derived from source', () => {
    const html = render();
    // No bare "N checks" / "N% of sites" claims — if a count is added later,
    // gate it the way ProofPoints.test.tsx gates RULE_AREA_COUNT.
    expect(html).not.toMatch(/\b\d+\s+checks?\b/i);
    expect(html).not.toMatch(/\b\d{2,}\s*%/);
  });

  it('states the scoring is not a per-engine ranking', () => {
    const html = render();
    expect(html).toMatch(/does not query those engines/i);
  });
});
