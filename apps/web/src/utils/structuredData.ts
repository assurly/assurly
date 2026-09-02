import { FAQ_ENTRIES } from './faq';
import { CURRENCY_CODE, PRICES, PRO_TRIAL_PERIOD_DAYS } from './pricing';
import { SITE_ORIGIN, publicPageUrl } from './siteMetadata';

/**
 * schema.org graphs for the public pages.
 *
 * Emitted as a single `@graph` per page with `@id` anchors rather than as
 * separate disconnected blocks. The anchors are what let the organization, the
 * website, the product and the page reference one another instead of being read
 * as four unrelated things that happen to share a domain — which is the whole
 * reason to publish structured data rather than hope the prose is parsed
 * correctly.
 *
 * Nothing here may assert something the site cannot show. In particular there is
 * no `aggregateRating` and no `review`: the product has no customers yet, and
 * inventing either is both a schema.org violation and, in the EU, an unfair
 * commercial practice under Annex I of Directive 2005/29/EC. The same reasoning
 * removed the fabricated testimonials this site used to carry.
 */

const ORGANIZATION_ID = `${SITE_ORIGIN}/#organization`;
const WEBSITE_ID = `${SITE_ORIGIN}/#website`;
const SOFTWARE_ID = `${SITE_ORIGIN}/#software`;
const LOGO_ID = `${SITE_ORIGIN}/#logo`;

/**
 * Defined as its own node rather than nested inside the Organization, so both
 * the organization and the page reference one image by `@id` instead of one
 * describing it and the other pointing at a definition buried in a sibling.
 */
function logo(): JsonLdNode {
  return {
    '@type': 'ImageObject',
    '@id': LOGO_ID,
    url: `${SITE_ORIGIN}/icon-512.png`,
    contentUrl: `${SITE_ORIGIN}/icon-512.png`,
    width: 512,
    height: 512,
  };
}

/** JSON-LD is plain data; this keeps the builders honest without pulling in a schema typings dependency. */
type JsonLdNode = Record<string, unknown>;

function absolute(path: string): string {
  return publicPageUrl(SITE_ORIGIN, path);
}

function organization(): JsonLdNode {
  return {
    '@type': 'Organization',
    '@id': ORGANIZATION_ID,
    name: 'Assurly',
    url: `${SITE_ORIGIN}/`,
    description:
      'Assurly is a pre-deploy ship gate for applications built with AI coding tools. It reads a project and returns one verdict — ready to ship, review, or blocked — before the code reaches production.',
    logo: { '@id': LOGO_ID },
    image: { '@id': LOGO_ID },
    // The operator is a natural person, named in the Terms and the Privacy
    // Policy. Stating it here is the same fact in machine-readable form, and it
    // is the authorship signal generative engines weigh.
    founder: {
      '@type': 'Person',
      name: 'Tibor Kútik',
    },
    address: {
      '@type': 'PostalAddress',
      streetAddress: 'Hlavná 454',
      postalCode: '941 33',
      addressLocality: 'Kolta',
      addressCountry: 'SK',
    },
    // Only profiles that are live and verifiable. A sameAs pointing at a 404
    // weakens entity resolution instead of strengthening it.
    sameAs: [
      'https://www.npmjs.com/package/assurly',
      'https://www.npmjs.com/package/@assurly/mcp-server',
      'https://www.npmjs.com/package/@assurly/scanner-core',
    ],
  };
}

function website(): JsonLdNode {
  return {
    '@type': 'WebSite',
    '@id': WEBSITE_ID,
    url: `${SITE_ORIGIN}/`,
    name: 'Assurly',
    publisher: { '@id': ORGANIZATION_ID },
    inLanguage: 'en',
  };
}

function softwareApplication(): JsonLdNode {
  return {
    '@type': 'SoftwareApplication',
    '@id': SOFTWARE_ID,
    name: 'Assurly',
    applicationCategory: 'DeveloperApplication',
    applicationSubCategory: 'Security',
    operatingSystem: 'Any',
    url: `${SITE_ORIGIN}/`,
    publisher: { '@id': ORGANIZATION_ID },
    description:
      'Pre-deploy ship gate for Next.js, Supabase, Stripe and Vercel projects. Scans locally for row-level security gaps, unverified Stripe webhooks, secrets in client bundles, install-time trust under npm 12, and the AI agent’s own MCP configuration, then returns a Ship Score out of 100.',
    softwareHelp: { '@type': 'CreativeWork', url: `${SITE_ORIGIN}/mcp` },
    offers: [
      {
        '@type': 'Offer',
        name: 'Free',
        price: PRICES.free,
        priceCurrency: CURRENCY_CODE,
        description:
          'Unlimited local CLI scans, the live URL proof-probe, one guarded app, and MCP server access for AI agents.',
        url: `${SITE_ORIGIN}/#pricing`,
      },
      {
        '@type': 'Offer',
        name: 'Pro',
        price: PRICES.guardMonthly,
        priceCurrency: CURRENCY_CODE,
        description: `${PRO_TRIAL_PERIOD_DAYS}-day free trial, then unlimited guarded apps, continuous monitoring on every deploy, AI deep review, auto-fix pull requests, and private repository scanning.`,
        url: `${SITE_ORIGIN}/#pricing`,
        priceSpecification: {
          '@type': 'UnitPriceSpecification',
          price: PRICES.guardMonthly,
          priceCurrency: CURRENCY_CODE,
          unitCode: 'MON',
          billingIncrement: 1,
        },
      },
    ],
  };
}

function faqPage(pageId: string): JsonLdNode {
  return {
    '@type': 'FAQPage',
    '@id': `${pageId}#faq`,
    isPartOf: { '@id': pageId },
    mainEntity: FAQ_ENTRIES.map((entry) => ({
      '@type': 'Question',
      name: entry.question,
      acceptedAnswer: {
        '@type': 'Answer',
        text: entry.answer,
      },
    })),
  };
}

function webPage(path: string, name: string, description: string): JsonLdNode {
  return {
    '@type': 'WebPage',
    '@id': absolute(path),
    url: absolute(path),
    name,
    description,
    isPartOf: { '@id': WEBSITE_ID },
    about: { '@id': ORGANIZATION_ID },
    inLanguage: 'en',
  };
}

function breadcrumbs(path: string, label: string): JsonLdNode {
  return {
    '@type': 'BreadcrumbList',
    '@id': `${absolute(path)}#breadcrumb`,
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: absolute('/') },
      { '@type': 'ListItem', position: 2, name: label, item: absolute(path) },
    ],
  };
}

function graph(nodes: JsonLdNode[]): JsonLdNode {
  return { '@context': 'https://schema.org', '@graph': nodes };
}

/**
 * The homepage carries the entity definitions the rest of the site references,
 * plus the product and the FAQ.
 */
export function homePageGraph(description: string): JsonLdNode {
  const pageId = absolute('/');
  return graph([
    logo(),
    organization(),
    website(),
    softwareApplication(),
    { ...webPage('/', 'Assurly', description), primaryImageOfPage: { '@id': LOGO_ID } },
    faqPage(pageId),
  ]);
}

/**
 * Sub-pages reference the entities by `@id` rather than restating them, which is
 * what keeps the site one entity to a crawler instead of several.
 */
export function subPageGraph(path: string, name: string, description: string): JsonLdNode {
  return graph([webPage(path, name, description), breadcrumbs(path, name)]);
}
