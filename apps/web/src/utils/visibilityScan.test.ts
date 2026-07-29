import { describe, expect, it } from 'vitest';
import {
  CHECK_WEIGHTS,
  VERDICT_PARTIAL_MIN,
  VERDICT_VISIBLE_MIN,
  scanVisibility,
  scoreChecks,
  type VisibilityCheck,
  type VisibilityInput,
  type VisibilityReport,
} from './visibilityScan';

const FINAL_URL = 'https://example.com/';

/** ~650 chars of visible copy so ai-ssr-content passes. */
const RICH_BODY = `${'Assurly helps teams ship secure SaaS to Vercel, Supabase, and Stripe. '.repeat(10)}Primary topic heading content for crawlers.`;

const VALID_JSON_LD = JSON.stringify({
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'Organization',
      '@id': 'https://example.com/#org',
      name: 'Example',
    },
    {
      '@type': 'WebSite',
      '@id': 'https://example.com/#website',
      publisher: { '@id': 'https://example.com/#org' },
      name: 'Example',
    },
  ],
});

const DANGLING_JSON_LD = JSON.stringify({
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'WebSite',
      '@id': 'https://example.com/#website',
      publisher: { '@id': 'https://example.com/#missing-org' },
      name: 'Example',
    },
  ],
});

const LLMS_TXT = `${'Assurly is a ship-gate for AI-built SaaS. '.repeat(8)}Cite https://assurly.dev for product facts.`;

function pageHtml(overrides: {
  title?: string;
  description?: string | null;
  canonical?: string | null;
  ogImage?: string | null;
  h1Count?: number;
  body?: string;
  jsonLd?: string | null;
  extraHead?: string;
}): string {
  const title = overrides.title ?? 'Example Ship Gate Page';
  const description =
    overrides.description === null
      ? ''
      : `<meta name="description" content="${overrides.description ?? 'Ship-ready security checks for AI-built SaaS apps.'}" />`;
  const canonical =
    overrides.canonical === null
      ? ''
      : `<link rel="canonical" href="${overrides.canonical ?? FINAL_URL}" />`;
  const ogImage =
    overrides.ogImage === null
      ? ''
      : `<meta property="og:image" content="${overrides.ogImage ?? 'https://example.com/og.png'}" />`;
  const h1Count = overrides.h1Count ?? 1;
  const h1s = Array.from({ length: h1Count }, (_, i) => `<h1>Heading ${i + 1}</h1>`).join('');
  const body = overrides.body ?? RICH_BODY;
  const jsonLd =
    overrides.jsonLd === null
      ? ''
      : `<script type="application/ld+json">${overrides.jsonLd ?? VALID_JSON_LD}</script>`;

  return `<!doctype html>
<html>
<head>
  <title>${title}</title>
  ${description}
  ${canonical}
  ${ogImage}
  ${overrides.extraHead ?? ''}
  ${jsonLd}
</head>
<body>
  ${h1s}
  <p>${body}</p>
</body>
</html>`;
}

function allPassInput(overrides: Partial<VisibilityInput> = {}): VisibilityInput {
  return {
    html: pageHtml({}),
    finalUrl: FINAL_URL,
    robotsTxt: 'User-agent: *\nAllow: /\n',
    llmsTxt: LLMS_TXT,
    ogImage: { status: 200, contentType: 'image/png' },
    ...overrides,
  };
}

function allFailInput(): VisibilityInput {
  return {
    html: `<!doctype html><html><head></head><body><div id="root"></div><script src="/app.js"></script></body></html>`,
    finalUrl: FINAL_URL,
    robotsTxt:
      'User-agent: GPTBot\nDisallow: /\nUser-agent: ClaudeBot\nDisallow: /\nUser-agent: PerplexityBot\nDisallow: /\nUser-agent: Google-Extended\nDisallow: /\n',
    llmsTxt: null,
    ogImage: null,
  };
}

function byId(report: VisibilityReport, id: string): VisibilityCheck {
  const check = report.checks.find((item) => item.id === id);
  if (!check) throw new Error(`Missing check ${id}`);
  return check;
}

describe('scanVisibility', () => {
  describe('ai-ssr-content', () => {
    it('passes a real server-rendered page and fails an empty SPA shell', () => {
      const rendered = scanVisibility(allPassInput());
      expect(byId(rendered, 'ai-ssr-content').status).toBe('pass');

      const shell = scanVisibility(
        allPassInput({
          html: `<html><body><div id="root"></div><script src="/bundle.js"></script></body></html>`,
        }),
      );
      expect(byId(shell, 'ai-ssr-content').status).toBe('fail');
      expect(byId(shell, 'ai-ssr-content').fix).toMatch(/server-rendered|initial HTML/i);
    });

    it('warns on thin content between empty and healthy thresholds', () => {
      const thinBody = 'x'.repeat(350);
      const report = scanVisibility(allPassInput({ html: pageHtml({ body: thinBody }) }));
      expect(byId(report, 'ai-ssr-content').status).toBe('warn');
      expect(byId(report, 'ai-ssr-content').fix).toBeTruthy();
    });
  });

  describe('ai-llms-txt', () => {
    it.each([
      {
        name: 'pass when non-trivial',
        llmsTxt: LLMS_TXT,
        status: 'pass' as const,
      },
      {
        name: 'fail when absent',
        llmsTxt: null,
        status: 'fail' as const,
      },
      {
        name: 'fail when trivial',
        llmsTxt: 'short',
        status: 'fail' as const,
      },
      {
        name: 'skipped when not fetched',
        llmsTxt: undefined,
        status: 'skipped' as const,
      },
    ])('$name', ({ llmsTxt, status }) => {
      const report = scanVisibility(allPassInput({ llmsTxt }));
      expect(byId(report, 'ai-llms-txt').status).toBe(status);
      if (status !== 'pass' && status !== 'skipped') {
        expect(byId(report, 'ai-llms-txt').fix).toMatch(/llms\.txt/i);
      }
    });
  });

  describe('ai-structured-data', () => {
    it('passes valid JSON-LD and fails when missing', () => {
      expect(byId(scanVisibility(allPassInput()), 'ai-structured-data').status).toBe('pass');

      const missing = scanVisibility(allPassInput({ html: pageHtml({ jsonLd: null }) }));
      expect(byId(missing, 'ai-structured-data').status).toBe('fail');
      expect(byId(missing, 'ai-structured-data').fix).toMatch(/application\/ld\+json/);
    });

    it('fails when JSON-LD does not parse or lacks @type', () => {
      const broken = scanVisibility(
        allPassInput({
          html: pageHtml({
            jsonLd: '{ not json',
          }),
        }),
      );
      expect(byId(broken, 'ai-structured-data').status).toBe('fail');

      const noType = scanVisibility(
        allPassInput({
          html: pageHtml({
            jsonLd: JSON.stringify({ '@context': 'https://schema.org', name: 'Example' }),
          }),
        }),
      );
      expect(byId(noType, 'ai-structured-data').status).toBe('fail');
    });
  });

  describe('ai-jsonld-references', () => {
    it('passes when bare @id references resolve in the same document', () => {
      const report = scanVisibility(allPassInput({ html: pageHtml({ jsonLd: VALID_JSON_LD }) }));
      expect(byId(report, 'ai-jsonld-references').status).toBe('pass');
    });

    it('fails when a bare @id reference is dangling', () => {
      const report = scanVisibility(allPassInput({ html: pageHtml({ jsonLd: DANGLING_JSON_LD }) }));
      const check = byId(report, 'ai-jsonld-references');
      expect(check.status).toBe('fail');
      expect(check.detail).toContain('https://example.com/#missing-org');
      expect(check.fix).toMatch(/@id/);
    });
  });

  describe('ai-crawler-access', () => {
    it('is skipped when robotsTxt is undefined and evaluates when null', () => {
      const skipped = scanVisibility(allPassInput({ robotsTxt: undefined }));
      expect(byId(skipped, 'ai-crawler-access').status).toBe('skipped');

      const absent = scanVisibility(allPassInput({ robotsTxt: null }));
      expect(byId(absent, 'ai-crawler-access').status).toBe('pass');
    });

    it('warns (never fails) when AI crawlers are blocked and names them', () => {
      const report = scanVisibility(
        allPassInput({
          robotsTxt: 'User-agent: GPTBot\nDisallow: /\nUser-agent: ClaudeBot\nDisallow: /\n',
        }),
      );
      const check = byId(report, 'ai-crawler-access');
      expect(check.status).toBe('warn');
      expect(check.detail).toContain('GPTBot');
      expect(check.detail).toContain('ClaudeBot');
      expect(check.fix).toBeTruthy();
    });
  });

  describe('seo-canonical', () => {
    it('passes when canonical matches finalUrl and fails otherwise', () => {
      expect(byId(scanVisibility(allPassInput()), 'seo-canonical').status).toBe('pass');

      const missing = scanVisibility(allPassInput({ html: pageHtml({ canonical: null }) }));
      expect(byId(missing, 'seo-canonical').status).toBe('fail');
      expect(byId(missing, 'seo-canonical').fix).toMatch(/rel="canonical"/);

      const elsewhere = scanVisibility(
        allPassInput({ html: pageHtml({ canonical: 'https://other.example/' }) }),
      );
      expect(byId(elsewhere, 'seo-canonical').status).toBe('fail');
    });
  });

  describe('seo-og-image', () => {
    it('passes when declared and HEAD is 2xx image/*', () => {
      expect(byId(scanVisibility(allPassInput()), 'seo-og-image').status).toBe('pass');
    });

    it('fails when missing, absent HEAD, or non-image response', () => {
      const missing = scanVisibility(allPassInput({ html: pageHtml({ ogImage: null }) }));
      expect(byId(missing, 'seo-og-image').status).toBe('fail');

      const absent = scanVisibility(allPassInput({ ogImage: null }));
      expect(byId(absent, 'seo-og-image').status).toBe('fail');
      expect(byId(absent, 'seo-og-image').fix).toMatch(/og:image/);

      const badType = scanVisibility(
        allPassInput({ ogImage: { status: 200, contentType: 'text/html' } }),
      );
      expect(byId(badType, 'seo-og-image').status).toBe('fail');
    });

    it('skips when declared but HEAD was not fetched', () => {
      const report = scanVisibility(allPassInput({ ogImage: undefined }));
      expect(byId(report, 'seo-og-image').status).toBe('skipped');
    });
  });

  describe('seo-title', () => {
    it('passes ideal length, warns when long, fails when missing', () => {
      expect(byId(scanVisibility(allPassInput()), 'seo-title').status).toBe('pass');

      const long = scanVisibility(
        allPassInput({
          html: pageHtml({ title: 'A'.repeat(61) }),
        }),
      );
      expect(byId(long, 'seo-title').status).toBe('warn');
      expect(byId(long, 'seo-title').fix).toMatch(/title/i);

      const missing = scanVisibility(
        allPassInput({
          html: '<html><head></head><body><h1>X</h1><p>' + RICH_BODY + '</p></body></html>',
        }),
      );
      expect(byId(missing, 'seo-title').status).toBe('fail');
    });
  });

  describe('seo-meta-description', () => {
    it('passes when present and fails when missing', () => {
      expect(byId(scanVisibility(allPassInput()), 'seo-meta-description').status).toBe('pass');

      const missing = scanVisibility(allPassInput({ html: pageHtml({ description: null }) }));
      expect(byId(missing, 'seo-meta-description').status).toBe('fail');
      expect(byId(missing, 'seo-meta-description').fix).toMatch(/meta name="description"/);
    });
  });

  describe('seo-single-h1', () => {
    it.each([
      { h1Count: 1, status: 'pass' as const },
      { h1Count: 0, status: 'fail' as const },
      { h1Count: 3, status: 'warn' as const },
    ])('h1Count=$h1Count → $status', ({ h1Count, status }) => {
      const report = scanVisibility(allPassInput({ html: pageHtml({ h1Count }) }));
      expect(byId(report, 'seo-single-h1').status).toBe(status);
      if (status !== 'pass') {
        expect(byId(report, 'seo-single-h1').fix).toMatch(/h1/i);
      }
    });
  });

  describe('markup robustness', () => {
    it('recognises single quotes, reordered attributes, uppercase tags, and self-closing link', () => {
      const html = `<!DOCTYPE HTML>
<HTML>
<HEAD>
  <TITLE>Robust Markup Page Title</TITLE>
  <META CONTENT="A robust description for the page." NAME="description">
  <LINK HREF="${FINAL_URL}" REL="canonical" />
  <META CONTENT="https://example.com/og.png" PROPERTY="og:image" />
  <SCRIPT TYPE="application/ld+json">${VALID_JSON_LD}</SCRIPT>
</HEAD>
<BODY>
  <H1>Main</H1>
  <P>${RICH_BODY}</P>
</BODY>
</HTML>`;

      const report = scanVisibility(allPassInput({ html }));
      expect(byId(report, 'seo-title').status).toBe('pass');
      expect(byId(report, 'seo-meta-description').status).toBe('pass');
      expect(byId(report, 'seo-canonical').status).toBe('pass');
      expect(byId(report, 'seo-og-image').status).toBe('pass');
      expect(byId(report, 'ai-structured-data').status).toBe('pass');
      expect(byId(report, 'seo-single-h1').status).toBe('pass');
    });

    it('handles single-quoted attributes on meta and link tags', () => {
      const html = `<html><head>
  <title>Example Ship Gate Page</title>
  <meta name='description' content='Ship-ready security checks for AI-built SaaS apps.' />
  <link rel='canonical' href='${FINAL_URL}' />
  <meta property='og:image' content='https://example.com/og.png' />
  <script type='application/ld+json'>${VALID_JSON_LD}</script>
</head><body><h1>Main</h1><p>${RICH_BODY}</p></body></html>`;
      const report = scanVisibility(allPassInput({ html }));
      expect(byId(report, 'seo-canonical').status).toBe('pass');
      expect(byId(report, 'seo-meta-description').status).toBe('pass');
      expect(byId(report, 'seo-og-image').status).toBe('pass');
      expect(byId(report, 'ai-structured-data').status).toBe('pass');
    });
  });

  describe('skipped semantics', () => {
    it('does not lower the score when a check is skipped', () => {
      const withRobots = scanVisibility(allPassInput({ robotsTxt: 'User-agent: *\nAllow: /\n' }));
      const withoutRobots = scanVisibility(allPassInput({ robotsTxt: undefined }));

      expect(byId(withoutRobots, 'ai-crawler-access').status).toBe('skipped');
      expect(withoutRobots.score).toBe(withRobots.score);
      expect(withoutRobots.aiReadinessScore).toBe(withRobots.aiReadinessScore);
    });
  });

  describe('scoring and verdict', () => {
    it('returns 100 for a group when every check in that group is skipped', () => {
      const checks: VisibilityCheck[] = [
        {
          id: 'ai-llms-txt',
          title: 'llms.txt is published',
          group: 'ai',
          status: 'skipped',
          detail: 'skipped',
        },
        {
          id: 'ai-crawler-access',
          title: 'AI crawler access in robots.txt',
          group: 'ai',
          status: 'skipped',
          detail: 'skipped',
        },
      ];
      expect(scoreChecks(checks)).toBe(100);
    });

    it('scores 100 / visible on all-pass; all-fail checks score 0; realistic collapse is invisible', () => {
      const pass = scanVisibility(allPassInput());
      expect(pass.checks.every((check) => check.status === 'pass')).toBe(true);
      expect(pass.score).toBe(100);
      expect(pass.aiReadinessScore).toBe(100);
      expect(pass.searchReadinessScore).toBe(100);
      expect(pass.verdict).toBe('visible');

      // Pure all-fail (synthetic): every weighted check failed → 0.
      const syntheticFail: VisibilityCheck[] = (
        Object.keys(CHECK_WEIGHTS) as Array<keyof typeof CHECK_WEIGHTS>
      ).map((id) => ({
        id,
        title: id,
        group: id.startsWith('ai-') ? 'ai' : 'search',
        status: 'fail',
        detail: 'fail',
        fix: 'fix',
      }));
      expect(scoreChecks(syntheticFail)).toBe(0);

      const fail = scanVisibility(allFailInput());
      // crawler-access warns rather than fails by design — half credit only
      const judged = fail.checks.filter((check) => check.id !== 'ai-crawler-access');
      expect(judged.every((check) => check.status === 'fail')).toBe(true);
      expect(byId(fail, 'ai-crawler-access').status).toBe('warn');
      expect(fail.score).toBe(4);
      expect(fail.verdict).toBe('invisible');
    });

    it('uses exact verdict boundaries on either side of each threshold', () => {
      const verdict = (score: number): 'visible' | 'partial' | 'invisible' => {
        if (score >= VERDICT_VISIBLE_MIN) return 'visible';
        if (score >= VERDICT_PARTIAL_MIN) return 'partial';
        return 'invisible';
      };

      expect(verdict(VERDICT_VISIBLE_MIN)).toBe('visible');
      expect(verdict(VERDICT_VISIBLE_MIN - 1)).toBe('partial');
      expect(verdict(VERDICT_PARTIAL_MIN)).toBe('partial');
      expect(verdict(VERDICT_PARTIAL_MIN - 1)).toBe('invisible');

      // Live scan on either side of VISIBLE_MIN (80): lose 40 → 80; lose 42.5 → 79.
      const atVisible = scanVisibility(
        allPassInput({
          html: pageHtml({ description: null, canonical: null }),
        }),
      );
      expect(atVisible.score).toBe(80);
      expect(atVisible.verdict).toBe('visible');

      const belowVisible = scanVisibility(
        allPassInput({
          html: pageHtml({ description: null, h1Count: 0 }),
          robotsTxt: 'User-agent: GPTBot\nDisallow: /\n',
        }),
      );
      expect(belowVisible.score).toBe(79);
      expect(belowVisible.verdict).toBe('partial');
    });
  });

  describe('ship-gate isolation guard', () => {
    it('never exposes ScannerFinding-shaped fields on the report', () => {
      const report = scanVisibility(allPassInput());
      expect(report).not.toHaveProperty('severity');
      expect(report).not.toHaveProperty('confidence');
      expect(report).not.toHaveProperty('findings');
      expect(report).not.toHaveProperty('blockers');

      for (const check of report.checks) {
        expect(check).not.toHaveProperty('severity');
        expect(check).not.toHaveProperty('confidence');
        expect(check).not.toHaveProperty('rule_id');
        expect(check).not.toHaveProperty('file_path');
        expect(check).not.toHaveProperty('suggestion');
        expect(Object.keys(CHECK_WEIGHTS)).toContain(check.id);
      }

      // Structural: VisibilityReport keys stay on the parallel report shape.
      expect(Object.keys(report).sort()).toEqual(
        ['aiReadinessScore', 'checks', 'score', 'searchReadinessScore', 'verdict'].sort(),
      );
    });
  });

  describe('fix presence', () => {
    it('requires fix on every non-pass, non-skipped check', () => {
      const report = scanVisibility(allFailInput());
      for (const check of report.checks) {
        if (check.status === 'pass' || check.status === 'skipped') {
          expect(check.fix).toBeUndefined();
        } else {
          expect(check.fix && check.fix.length > 10).toBe(true);
        }
      }
    });
  });
});
