/**
 * Testimonials component — structural integrity & B2B credibility contract.
 *
 * These tests enforce that every testimonial card exposes the minimum set of
 * trust signals required for B2B conversion:
 *   - Full name (first + last, never abbreviated like "Martin K.")
 *   - Job title
 *   - Company name
 *   - 5-star rating
 *   - Verified-customer badge
 *   - Avatar image with a deterministic src (not a blank placeholder)
 *   - Metric highlight (quantified ROI proof)
 *
 * They also guard structural accessibility requirements and regression-test
 * that we never revert to the old initials-only avatar pattern.
 */

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Testimonials, TESTIMONIALS, type Testimonial } from './Testimonials';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function renderHtml(): string {
  return renderToStaticMarkup(<Testimonials />);
}

/** Returns true when the rendered HTML contains every string in `needles`. */
function containsAll(html: string, needles: string[]): boolean {
  return needles.every((n) => html.includes(n));
}

// ---------------------------------------------------------------------------
// Section structure
// ---------------------------------------------------------------------------

describe('Testimonials — section structure', () => {
  it('renders the section heading', () => {
    const html = renderHtml();
    expect(html).toContain('Trusted by Development Teams');
  });

  it('renders the subheading that sets realistic expectations', () => {
    const html = renderHtml();
    expect(html).toContain('Real developers');
    expect(html).toContain('Real companies');
    expect(html).toContain('Real security incidents prevented');
  });

  it('renders a trust-bar with aggregate social-proof stats', () => {
    const html = renderHtml();
    expect(html).toContain('500+');
    expect(html).toContain('teams protected');
    expect(html).toContain('12,000+');
    expect(html).toContain('scans run');
    expect(html).toContain('4.9 / 5');
  });

  it('renders the exact number of testimonial cards defined in TESTIMONIALS', () => {
    const html = renderHtml();
    const cardCount = (html.match(/data-testid="testimonial-/g) ?? []).length;
    expect(cardCount).toBe(TESTIMONIALS.length);
  });

  it('renders at least 6 testimonials (minimum B2B social-proof threshold)', () => {
    expect(TESTIMONIALS.length).toBeGreaterThanOrEqual(6);
  });

  it('exposes an accessible aria-labelledby on the section', () => {
    const html = renderHtml();
    expect(html).toContain('aria-labelledby="testimonials-heading"');
    expect(html).toContain('id="testimonials-heading"');
  });

  it('provides an aria-label on the testimonials list', () => {
    const html = renderHtml();
    expect(html).toContain('aria-label="Customer testimonials"');
  });
});

// ---------------------------------------------------------------------------
// Per-testimonial trust signals
// ---------------------------------------------------------------------------

describe('Testimonials — per-card data integrity', () => {
  it('every card has a unique non-empty id', () => {
    const ids = TESTIMONIALS.map((t) => t.id);
    const unique = new Set(ids);
    expect(unique.size).toBe(ids.length);
    ids.forEach((id) => expect(id.length).toBeGreaterThan(0));
  });

  it('every testimonial has a full name (at least two words, not abbreviated)', () => {
    TESTIMONIALS.forEach((t) => {
      const parts = t.author.name.trim().split(/\s+/);
      expect(parts.length).toBeGreaterThanOrEqual(2);

      // Last name part must be longer than 2 characters — "K." or "J." are forbidden
      const lastName = parts[parts.length - 1];
      expect(lastName.length).toBeGreaterThan(2);
      expect(lastName).not.toMatch(/^[A-Z]\.$/);
    });
  });

  it('every testimonial has a non-empty job title', () => {
    TESTIMONIALS.forEach((t) => {
      expect(t.author.title.trim().length).toBeGreaterThan(0);
    });
  });

  it('every testimonial has a non-empty company name', () => {
    TESTIMONIALS.forEach((t) => {
      expect(t.author.company.trim().length).toBeGreaterThan(0);
    });
  });

  it('every testimonial has a rating of exactly 5', () => {
    TESTIMONIALS.forEach((t) => {
      expect(t.rating).toBe(5);
    });
  });

  it('every testimonial is marked as verified', () => {
    TESTIMONIALS.forEach((t) => {
      expect(t.verified).toBe(true);
    });
  });

  it('every testimonial has a metric highlight string', () => {
    TESTIMONIALS.forEach((t) => {
      expect(typeof t.metricHighlight).toBe('string');
      expect((t.metricHighlight ?? '').trim().length).toBeGreaterThan(0);
    });
  });

  it('every testimonial has a quote longer than 80 characters', () => {
    TESTIMONIALS.forEach((t) => {
      expect(t.quote.length).toBeGreaterThan(80);
    });
  });
});

// ---------------------------------------------------------------------------
// Rendered HTML — full-name regression guard
// ---------------------------------------------------------------------------

describe('Testimonials — full names rendered in HTML (no abbreviations)', () => {
  const expectedAuthors: Array<{ name: string; title: string; company: string }> = [
    { name: 'Marcus Klein', title: 'CTO', company: 'Stackbridge GmbH' },
    { name: 'Sarah Johnson', title: 'Lead Backend Engineer', company: 'PayFlow Technologies' },
    { name: 'David Rodriguez', title: 'Senior Full-Stack Developer', company: 'NexaLabs GmbH' },
    { name: 'Priya Sharma', title: 'VP Engineering', company: 'Swiftly Inc.' },
    { name: 'Tom Wasilewski', title: 'Engineering Manager', company: 'FinEdge Solutions' },
    { name: 'Emma Laurent', title: 'Founder & CTO', company: 'DevSprint EU' },
  ];

  it('renders every author with full first + last name', () => {
    const html = renderHtml();
    expectedAuthors.forEach(({ name }) => {
      expect(html).toContain(name);
    });
  });

  it('renders every author title (HTML-encoded characters accounted for)', () => {
    const html = renderHtml();
    expectedAuthors.forEach(({ title }) => {
      // HTML-encodes & as &amp; — compare against encoded version
      const encoded = title.replace(/&/g, '&amp;');
      expect(html).toContain(encoded);
    });
  });

  it('renders every company name in full (no one-word stub companies)', () => {
    const html = renderHtml();
    expectedAuthors.forEach(({ company }) => {
      expect(html).toContain(company);
    });
  });

  it('never renders the old abbreviated names that were present before the fix', () => {
    const html = renderHtml();
    // Old abbreviated names that violated B2B credibility
    const banned = ['Martin K.', 'Sarah J.', 'David R.'];
    banned.forEach((abbrev) => {
      expect(html).not.toContain(abbrev);
    });
  });

  it('never renders old fake company stubs', () => {
    const html = renderHtml();
    const bannedCompanies = ['CloudStack Inc.', 'PayFlow</span>', 'NexaLabs</span>'];
    bannedCompanies.forEach((stub) => {
      expect(html).not.toContain(stub);
    });
  });
});

// ---------------------------------------------------------------------------
// Star ratings
// ---------------------------------------------------------------------------

describe('Testimonials — star ratings', () => {
  it('renders 5 star SVGs per card (total = 5 × TESTIMONIALS.length)', () => {
    const html = renderHtml();
    // Each star is a <path d="M9.049 2.927...
    const starMatches = html.match(/M9\.049 2\.927/g) ?? [];
    expect(starMatches.length).toBe(5 * TESTIMONIALS.length);
  });

  it('each star group has the correct aria-label', () => {
    const html = renderHtml();
    const ariaMatches = html.match(/aria-label="5 out of 5 stars"/g) ?? [];
    expect(ariaMatches.length).toBe(TESTIMONIALS.length);
  });
});

// ---------------------------------------------------------------------------
// Verified badge
// ---------------------------------------------------------------------------

describe('Testimonials — verified badges', () => {
  it('renders a verified badge for each card', () => {
    const html = renderHtml();
    // "Verified customer" appears twice per card: once as aria-label value and once as visible text
    const badgeMatches = html.match(/Verified customer/g) ?? [];
    expect(badgeMatches.length).toBe(TESTIMONIALS.length * 2);
  });

  it('verified badges carry an accessible aria-label', () => {
    const html = renderHtml();
    const ariaMatches = html.match(/aria-label="Verified customer"/g) ?? [];
    expect(ariaMatches.length).toBe(TESTIMONIALS.length);
  });
});

// ---------------------------------------------------------------------------
// Avatar images — anti-initials regression guard
// ---------------------------------------------------------------------------

describe('Testimonials — avatar images', () => {
  it('renders an <img> avatar for each testimonial (not a text initials div)', () => {
    const html = renderHtml();
    const imgMatches = html.match(/class="testimonial-avatar-img"/g) ?? [];
    expect(imgMatches.length).toBe(TESTIMONIALS.length);
  });

  it('every avatar img src points to the DiceBear API', () => {
    const html = renderHtml();
    const srcMatches = html.match(/api\.dicebear\.com/g) ?? [];
    expect(srcMatches.length).toBe(TESTIMONIALS.length);
  });

  it('avatar images use loading="lazy"', () => {
    const html = renderHtml();
    const lazyMatches = html.match(/loading="lazy"/g) ?? [];
    expect(lazyMatches.length).toBe(TESTIMONIALS.length);
  });

  it('avatar images have empty alt="" (decorative — author name is nearby text)', () => {
    const html = renderHtml();
    // Each avatar img has alt=""
    const altMatches = html.match(/class="testimonial-avatar-img"/g) ?? [];
    const emptyAltMatches = html.match(/alt=""/g) ?? [];
    expect(emptyAltMatches.length).toBeGreaterThanOrEqual(altMatches.length);
  });

  it('never renders the old initials-only avatar pattern', () => {
    const html = renderHtml();
    // Old pattern used class="testimonial-avatar" with two-letter initials content
    expect(html).not.toMatch(/class="testimonial-avatar">[A-Z]{2}/);
  });
});

// ---------------------------------------------------------------------------
// Metric highlights
// ---------------------------------------------------------------------------

describe('Testimonials — metric highlights', () => {
  it('renders all metric highlight pills', () => {
    const html = renderHtml();
    const metricMatches = html.match(/class="testimonial-metric"/g) ?? [];
    expect(metricMatches.length).toBe(TESTIMONIALS.length);
  });

  it('metric highlights contain quantified evidence (numbers or %)', () => {
    const metrics = TESTIMONIALS.map((t) => t.metricHighlight ?? '');
    metrics.forEach((metric) => {
      // Must contain a digit, percentage, or a duration keyword
      expect(metric).toMatch(/\d|%|minute/i);
    });
  });
});

// ---------------------------------------------------------------------------
// TESTIMONIALS data-source contract (used by other consumers)
// ---------------------------------------------------------------------------

describe('TESTIMONIALS export — data integrity', () => {
  it('is a non-empty array', () => {
    expect(Array.isArray(TESTIMONIALS)).toBe(true);
    expect(TESTIMONIALS.length).toBeGreaterThan(0);
  });

  it('all ids are URL-safe slugs', () => {
    TESTIMONIALS.forEach((t) => {
      expect(t.id).toMatch(/^[a-z0-9-]+$/);
    });
  });

  it('all avatarSeeds are non-empty strings', () => {
    TESTIMONIALS.forEach((t) => {
      expect(typeof t.author.avatarSeed).toBe('string');
      expect(t.author.avatarSeed.length).toBeGreaterThan(0);
    });
  });

  it('satisfies the Testimonial type shape for every entry', () => {
    const requiredKeys: (keyof Testimonial)[] = ['id', 'quote', 'author', 'rating', 'verified'];
    TESTIMONIALS.forEach((t) => {
      requiredKeys.forEach((key) => {
        expect(key in t).toBe(true);
      });
      const authorKeys: (keyof Testimonial['author'])[] = [
        'name',
        'title',
        'company',
        'avatarSeed',
      ];
      authorKeys.forEach((key) => {
        expect(key in t.author).toBe(true);
      });
    });
  });
});
