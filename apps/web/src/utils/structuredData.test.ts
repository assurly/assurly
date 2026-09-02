import { describe, expect, it } from 'vitest';
import { FAQ_ENTRIES } from './faq';
import { CURRENCY_CODE, PRICES } from './pricing';
import { homePageGraph, subPageGraph } from './structuredData';

type Node = Record<string, unknown>;

interface QuestionNode {
  name: string;
  acceptedAnswer: { text: string };
}

interface OfferNode {
  name: string;
  price: number;
  priceCurrency: string;
  description?: string;
}

function nodesOf(graph: Node): Node[] {
  return graph['@graph'] as Node[];
}

function findByType(graph: Node, type: string): Node {
  const node = nodesOf(graph).find((candidate) => candidate['@type'] === type);
  if (!node) throw new Error(`graph has no ${type} node`);
  return node;
}

/** Every `{"@id": …}` used as a reference, i.e. an object carrying nothing else. */
function referencesIn(graph: Node): string[] {
  const found: string[] = [];
  JSON.stringify(graph, (_key, value) => {
    if (
      value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      Object.keys(value).length === 1 &&
      typeof value['@id'] === 'string'
    ) {
      found.push(value['@id']);
    }
    return value;
  });
  return found;
}

describe('structured data', () => {
  it('anchors every node and leaves no reference dangling', () => {
    for (const graph of [homePageGraph('Home'), subPageGraph('/mcp', 'MCP Server', 'MCP')]) {
      const defined = new Set(nodesOf(graph).map((node) => node['@id']));
      // A reference to an id nothing defines is the one failure mode `@id`
      // anchoring exists to prevent, and it is invisible in rendered output.
      for (const reference of referencesIn(graph)) {
        // Cross-page references point at nodes the home graph defines.
        if (reference.endsWith('#organization') || reference.endsWith('#website')) continue;
        expect(defined, `dangling reference ${reference}`).toContain(reference);
      }
    }
  });

  it('uses absolute, stable ids rather than the deployment origin', () => {
    for (const node of nodesOf(homePageGraph('Home'))) {
      expect(String(node['@id'])).toMatch(/^https:\/\/assurly\.dev\//);
    }
  });

  it('publishes every FAQ answer verbatim, so markup and page cannot disagree', () => {
    const questions = findByType(homePageGraph('Home'), 'FAQPage').mainEntity as QuestionNode[];

    expect(questions).toHaveLength(FAQ_ENTRIES.length);
    for (const [index, entry] of FAQ_ENTRIES.entries()) {
      expect(questions[index].name).toBe(entry.question);
      expect(questions[index].acceptedAnswer.text).toBe(entry.answer);
    }
  });

  it('quotes the prices the pricing cards show', () => {
    const offers = findByType(homePageGraph('Home'), 'SoftwareApplication').offers as OfferNode[];

    expect(offers.find((offer) => offer.name === 'Free')?.price).toBe(PRICES.free);
    expect(offers.find((offer) => offer.name === 'Pro')?.price).toBe(PRICES.guardMonthly);
  });

  /**
   * Search engines and AI assistants quote this block directly, and a wrong
   * currency here is repeated far beyond any page we can correct. Stripe can
   * only charge euros, so every offer must say so.
   */
  it('publishes every offer in the currency Stripe can charge', () => {
    const application = findByType(homePageGraph('Home'), 'SoftwareApplication');
    const offers = application.offers as OfferNode[];

    expect(offers.length).toBeGreaterThan(0);
    for (const offer of offers) {
      expect(offer.priceCurrency).toBe(CURRENCY_CODE);
    }
    expect(JSON.stringify(application)).not.toContain('USD');
  });

  it('describes the Pro offer as starting with a 3-day trial', () => {
    const offers = findByType(homePageGraph('Home'), 'SoftwareApplication').offers as OfferNode[];
    expect(offers.find((offer) => offer.name === 'Pro')?.description).toMatch(/^3-day free trial/);
  });

  it('uses the origin form for the homepage so it matches sitemap loc', () => {
    const page = findByType(homePageGraph('Home'), 'WebPage');
    expect(page.url).toBe('https://assurly.dev/');
    expect(page['@id']).toBe('https://assurly.dev/');
  });

  /**
   * The site removed its fabricated testimonials because inventing consumer
   * reviews is unfair in all circumstances under Annex I of Directive
   * 2005/29/EC. Asserting the same claim cannot reappear in machine-readable
   * form closes the door the markup would otherwise leave open.
   */
  it('claims no ratings or reviews for a product with no customers', () => {
    const serialised = JSON.stringify(homePageGraph('Home'));

    expect(serialised).not.toContain('aggregateRating');
    expect(serialised).not.toContain('"review"');
    expect(serialised).not.toContain('ratingValue');
  });
});
