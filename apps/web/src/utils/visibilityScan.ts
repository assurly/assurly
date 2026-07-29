/**
 * Visibility (SEO + GEO / AI-readiness) scoring — Phase 1.
 *
 * Pure, self-contained, and deliberately SEPARATE from Ship Gate.
 *
 * Ship Gate degrades both shipScore and verdict on ANY finding. A missing
 * og:image must never turn a secure app from READY TO SHIP into REVIEW
 * RECOMMENDED. This module therefore defines its own result types, never
 * emits ScannerFinding objects, and never imports shipGate.
 *
 * No DOM, no HTML parser dependency — regex extraction only (same style as
 * extractScriptUrls in runtimeScanner). Runs server-side; jsdom is not
 * available at runtime.
 */

export type VisibilityStatus = 'pass' | 'warn' | 'fail' | 'skipped';
export type VisibilityVerdict = 'invisible' | 'partial' | 'visible';
export type VisibilityGroup = 'ai' | 'search';

export interface VisibilityInput {
  /** Server-rendered HTML of the page, exactly as delivered. */
  html: string;
  /** Final URL after redirects — needed to resolve relative canonicals. */
  finalUrl: string;
  /** `undefined` = not fetched (budget/skip). `null` = fetched, absent (404). */
  robotsTxt?: string | null;
  sitemapXml?: string | null;
  llmsTxt?: string | null;
  /** Result of a HEAD on the declared og:image, same undefined/null rule. */
  ogImage?: { status: number; contentType: string | null } | null;
}

export interface VisibilityCheck {
  id: string;
  /** Short human label, e.g. "Content is server-rendered". */
  title: string;
  group: VisibilityGroup;
  status: VisibilityStatus;
  /** What was actually observed, specific enough to act on. */
  detail: string;
  /** Present unless status is 'pass' or 'skipped'. */
  fix?: string;
}

export interface VisibilityReport {
  checks: VisibilityCheck[];
  aiReadinessScore: number;
  searchReadinessScore: number;
  score: number;
  verdict: VisibilityVerdict;
}

/**
 * Explicit per-check weights. AI and search groups each sum to 100 so a fully
 * evaluated group scores on a clean 0–100 scale without hidden multipliers.
 */
export const CHECK_WEIGHTS = {
  'ai-ssr-content': 30,
  'ai-llms-txt': 15,
  'ai-structured-data': 20,
  'ai-jsonld-references': 20,
  'ai-crawler-access': 15,
  'seo-canonical': 20,
  'seo-og-image': 25,
  'seo-title': 20,
  'seo-meta-description': 20,
  'seo-single-h1': 15,
} as const;

export type VisibilityCheckId = keyof typeof CHECK_WEIGHTS;

/**
 * Overall score ≥ this → machines can reliably discover and cite the page.
 * Set below a perfect 100 so a single half-credit warn (e.g. long title) still
 * lands as `visible` when everything else passes.
 */
export const VERDICT_VISIBLE_MIN = 80;

/**
 * Overall score below this → effectively invisible to crawlers/AI.
 * Mid-band between 0 and VISIBLE_MIN: enough signal that something is indexable,
 * but material gaps remain. Chosen so an all-warn group (~50) is `partial`,
 * while a mix dominated by fails falls to `invisible`.
 */
export const VERDICT_PARTIAL_MIN = 45;

/** SSR body below this char count is an empty shell (typical SPA root div). */
const SSR_EMPTY_MAX = 200;
/** SSR body below this is thin — indexable but weak for citation. */
const SSR_THIN_MAX = 600;
/** llms.txt shorter than this is present-but-useless for AI agents. */
const LLMS_MIN_CHARS = 200;
/** Search-snippet title length; longer still works but truncates in SERPs. */
const TITLE_IDEAL_MAX = 60;

const AI_CRAWLERS = ['GPTBot', 'ClaudeBot', 'PerplexityBot', 'Google-Extended'] as const;

type AiCrawler = (typeof AI_CRAWLERS)[number];

function getAttr(tag: string, name: string): string | null {
  const quoted = new RegExp(`\\b${name}\\s*=\\s*(["'])([\\s\\S]*?)\\1`, 'i');
  const quotedMatch = tag.match(quoted);
  if (quotedMatch?.[2] !== undefined) return quotedMatch[2];
  const unquoted = new RegExp(`\\b${name}\\s*=\\s*([^\\s>/"']+)`, 'i');
  return tag.match(unquoted)?.[1] ?? null;
}

function extractVisibleText(html: string): string {
  const withoutBlocks = html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, ' ');
  const withoutTags = withoutBlocks.replace(/<[^>]+>/g, ' ');
  return withoutTags.replace(/\s+/g, ' ').trim();
}

function extractTitle(html: string): string | null {
  const match = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
  if (!match?.[1]) return null;
  return match[1].replace(/\s+/g, ' ').trim();
}

function extractMetaByName(html: string, name: string): string | null {
  const metaPattern = /<meta\b[^>]*>/gi;
  for (const match of html.matchAll(metaPattern)) {
    const tag = match[0];
    const attrName = getAttr(tag, 'name');
    if (attrName && attrName.toLowerCase() === name.toLowerCase()) {
      return getAttr(tag, 'content');
    }
  }
  return null;
}

function extractMetaByProperty(html: string, property: string): string | null {
  const metaPattern = /<meta\b[^>]*>/gi;
  for (const match of html.matchAll(metaPattern)) {
    const tag = match[0];
    const attrProperty = getAttr(tag, 'property');
    if (attrProperty && attrProperty.toLowerCase() === property.toLowerCase()) {
      return getAttr(tag, 'content');
    }
  }
  return null;
}

function extractCanonicalHref(html: string): string | null {
  const linkPattern = /<link\b[^>]*>/gi;
  for (const match of html.matchAll(linkPattern)) {
    const tag = match[0];
    const rel = getAttr(tag, 'rel');
    if (!rel) continue;
    const tokens = rel.toLowerCase().split(/\s+/);
    if (tokens.includes('canonical')) {
      return getAttr(tag, 'href');
    }
  }
  return null;
}

function countH1(html: string): number {
  const matches = html.match(/<h1\b[^>]*>/gi);
  return matches?.length ?? 0;
}

function extractJsonLdBlocks(html: string): string[] {
  const blocks: string[] = [];
  // Lookahead so type= may appear before or after other attributes.
  const pattern =
    /<script\b(?=[^>]*\btype\s*=\s*["']application\/ld\+json["'])[^>]*>([\s\S]*?)<\/script>/gi;
  for (const match of html.matchAll(pattern)) {
    if (match[1] !== undefined) blocks.push(match[1].trim());
  }
  return blocks;
}

function normalizeUrlForCompare(url: string): string {
  const parsed = new URL(url);
  let path = parsed.pathname;
  if (path.length > 1 && path.endsWith('/')) {
    path = path.slice(0, -1);
  }
  return `${parsed.protocol}//${parsed.host}${path}${parsed.search}`;
}

function urlsPointAtSamePage(candidate: string, finalUrl: string): boolean {
  try {
    const resolved = new URL(candidate, finalUrl).toString();
    return normalizeUrlForCompare(resolved) === normalizeUrlForCompare(finalUrl);
  } catch {
    return false;
  }
}

function hasContext(value: unknown): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    '@context' in value &&
    (value as { '@context': unknown })['@context'] != null
  );
}

function hasType(value: unknown): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    '@type' in value &&
    (value as { '@type': unknown })['@type'] != null
  );
}

/**
 * A block is valid when it has @context and @type on the root, or @context on
 * the root with every @graph node carrying @type (the common Schema.org shape).
 */
function jsonLdBlockIsValid(parsed: unknown): boolean {
  if (Array.isArray(parsed)) {
    return parsed.length > 0 && parsed.every((item) => hasContext(item) && hasType(item));
  }
  if (typeof parsed !== 'object' || parsed === null) return false;

  const record = parsed as Record<string, unknown>;
  if (!hasContext(record)) return false;
  if (hasType(record)) return true;

  const graph = record['@graph'];
  if (!Array.isArray(graph) || graph.length === 0) return false;
  return graph.every((node) => hasType(node));
}

function collectJsonLdNodes(parsed: unknown, out: unknown[]): void {
  if (Array.isArray(parsed)) {
    for (const item of parsed) collectJsonLdNodes(item, out);
    return;
  }
  if (typeof parsed !== 'object' || parsed === null) return;
  out.push(parsed);
  const record = parsed as Record<string, unknown>;
  if (Array.isArray(record['@graph'])) {
    for (const node of record['@graph']) collectJsonLdNodes(node, out);
  }
}

function isBareIdReference(value: unknown): value is { '@id': string } {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const keys = Object.keys(value);
  if (keys.length !== 1 || keys[0] !== '@id') return false;
  return typeof (value as { '@id': unknown })['@id'] === 'string';
}

function walkForBareRefs(value: unknown, refs: string[]): void {
  if (Array.isArray(value)) {
    for (const item of value) walkForBareRefs(item, refs);
    return;
  }
  if (typeof value !== 'object' || value === null) return;
  if (isBareIdReference(value)) {
    refs.push(value['@id']);
    return;
  }
  for (const child of Object.values(value)) {
    walkForBareRefs(child, refs);
  }
}

function definedIdsInDocument(nodes: unknown[]): Set<string> {
  const ids = new Set<string>();
  for (const node of nodes) {
    if (typeof node !== 'object' || node === null || Array.isArray(node)) continue;
    const record = node as Record<string, unknown>;
    const id = record['@id'];
    if (typeof id !== 'string') continue;
    // A defining node carries more than a lone @id (type, name, etc.).
    if (Object.keys(record).length > 1) {
      ids.add(id);
    }
  }
  return ids;
}

/**
 * Parse robots.txt into agent → rule lines. Consecutive User-agent lines share
 * the following Allow/Disallow set; a User-agent after rules starts a new group.
 */
function parseRobotsGroups(robotsTxt: string): Array<{ agents: string[]; rules: string[] }> {
  const groups: Array<{ agents: string[]; rules: string[] }> = [];
  let agents: string[] = [];
  let rules: string[] = [];
  let acceptingAgents = true;

  const flush = (): void => {
    if (agents.length === 0) return;
    groups.push({ agents, rules });
    agents = [];
    rules = [];
    acceptingAgents = true;
  };

  for (const rawLine of robotsTxt.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, '').trim();
    if (!line) continue;

    const uaMatch = line.match(/^user-agent\s*:\s*(.+)$/i);
    if (uaMatch?.[1]) {
      if (!acceptingAgents) flush();
      agents.push(uaMatch[1].trim().toLowerCase());
      continue;
    }

    const disallowMatch = line.match(/^disallow\s*:\s*(.*)$/i);
    if (disallowMatch) {
      acceptingAgents = false;
      rules.push(`disallow:${(disallowMatch[1] ?? '').trim()}`);
      continue;
    }

    const allowMatch = line.match(/^allow\s*:\s*(.*)$/i);
    if (allowMatch) {
      acceptingAgents = false;
      rules.push(`allow:${(allowMatch[1] ?? '').trim()}`);
    }
  }
  flush();
  return groups;
}

/**
 * Pragmatic whole-site block detector: Disallow: / (with no Allow: /) in the
 * agent-specific group, else in the * group. Report-only — never a fail.
 */
function isCrawlerBlocked(robotsTxt: string, crawler: AiCrawler): boolean {
  const groups = parseRobotsGroups(robotsTxt);
  const agentKey = crawler.toLowerCase();
  const specific = groups.find((group) => group.agents.includes(agentKey));
  const star = groups.find((group) => group.agents.includes('*'));
  const rules = specific?.rules ?? star?.rules ?? [];

  const disallowsRoot = rules.some((rule) => rule === 'disallow:/');
  const allowsRoot = rules.some((rule) => rule === 'allow:/' || rule === 'allow:');
  return disallowsRoot && !allowsRoot;
}

function creditForStatus(status: VisibilityStatus): number | null {
  switch (status) {
    case 'pass':
      return 1;
    case 'warn':
      return 0.5;
    case 'fail':
      return 0;
    case 'skipped':
      return null;
    default: {
      const exhaustive: never = status;
      throw new Error(`Unknown visibility status: ${String(exhaustive)}`);
    }
  }
}

/**
 * Weighted score for a set of checks. Skipped checks are excluded from both
 * numerator and denominator. When every check is skipped, return 100 — a
 * budget-exhausted scan must not look like a failing site (null-free API).
 */
export function scoreChecks(checks: readonly VisibilityCheck[]): number {
  let numerator = 0;
  let denominator = 0;

  for (const check of checks) {
    const weight = CHECK_WEIGHTS[check.id as VisibilityCheckId];
    if (weight === undefined) continue;
    const credit = creditForStatus(check.status);
    if (credit === null) continue;
    numerator += weight * credit;
    denominator += weight;
  }

  if (denominator === 0) return 100;
  return Math.round((100 * numerator) / denominator);
}

function verdictFromScore(score: number): VisibilityVerdict {
  if (score >= VERDICT_VISIBLE_MIN) return 'visible';
  if (score >= VERDICT_PARTIAL_MIN) return 'partial';
  return 'invisible';
}

function checkSsrContent(html: string): VisibilityCheck {
  const text = extractVisibleText(html);
  const length = text.length;

  if (length < SSR_EMPTY_MAX) {
    return {
      id: 'ai-ssr-content',
      title: 'Content is server-rendered',
      group: 'ai',
      status: 'fail',
      detail: `Visible server HTML text is ${length} characters (near-empty SPA shell).`,
      fix: `Render the primary page copy in the initial HTML response (at least ${SSR_THIN_MAX} characters of visible text). Empty <div id="root"></div> shells are invisible to AI crawlers.`,
    };
  }

  if (length < SSR_THIN_MAX) {
    return {
      id: 'ai-ssr-content',
      title: 'Content is server-rendered',
      group: 'ai',
      status: 'warn',
      detail: `Visible server HTML text is ${length} characters (thin for reliable AI citation).`,
      fix: `Expand the server-rendered body to at least ${SSR_THIN_MAX} characters of meaningful page text so AI crawlers can cite the page.`,
    };
  }

  return {
    id: 'ai-ssr-content',
    title: 'Content is server-rendered',
    group: 'ai',
    status: 'pass',
    detail: `Visible server HTML text is ${length} characters.`,
  };
}

function checkLlmsTxt(llmsTxt: string | null | undefined): VisibilityCheck {
  if (llmsTxt === undefined) {
    return {
      id: 'ai-llms-txt',
      title: 'llms.txt is published',
      group: 'ai',
      status: 'skipped',
      detail: 'llms.txt was not fetched (budget or skip).',
    };
  }

  if (llmsTxt === null || llmsTxt.trim().length === 0) {
    return {
      id: 'ai-llms-txt',
      title: 'llms.txt is published',
      group: 'ai',
      status: 'fail',
      detail: 'llms.txt is absent or empty.',
      fix: `Serve /llms.txt with a clear site summary of more than ${LLMS_MIN_CHARS} characters describing what the product is and how to cite it.`,
    };
  }

  const length = llmsTxt.trim().length;
  if (length <= LLMS_MIN_CHARS) {
    return {
      id: 'ai-llms-txt',
      title: 'llms.txt is published',
      group: 'ai',
      status: 'fail',
      detail: `llms.txt is only ${length} characters (trivial).`,
      fix: `Expand /llms.txt to more than ${LLMS_MIN_CHARS} characters with product purpose, key URLs, and citation guidance.`,
    };
  }

  return {
    id: 'ai-llms-txt',
    title: 'llms.txt is published',
    group: 'ai',
    status: 'pass',
    detail: `llms.txt is present (${length} characters).`,
  };
}

function checkStructuredData(html: string): VisibilityCheck {
  const blocks = extractJsonLdBlocks(html);
  if (blocks.length === 0) {
    return {
      id: 'ai-structured-data',
      title: 'Structured data (JSON-LD) present',
      group: 'ai',
      status: 'fail',
      detail: 'No <script type="application/ld+json"> blocks found.',
      fix: 'Add at least one <script type="application/ld+json"> block with "@context" and "@type" (or an "@graph" of typed nodes).',
    };
  }

  const invalidReasons: string[] = [];
  for (let i = 0; i < blocks.length; i += 1) {
    const raw = blocks[i]!;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      invalidReasons.push(`block ${i + 1} is not valid JSON`);
      continue;
    }
    if (!jsonLdBlockIsValid(parsed)) {
      invalidReasons.push(`block ${i + 1} is missing @context or @type`);
    }
  }

  if (invalidReasons.length > 0) {
    return {
      id: 'ai-structured-data',
      title: 'Structured data (JSON-LD) present',
      group: 'ai',
      status: 'fail',
      detail: `Found ${blocks.length} JSON-LD block(s), but ${invalidReasons.join('; ')}.`,
      fix: 'Ensure every JSON-LD block parses as JSON and includes "@context" plus "@type" on the root or on each "@graph" node.',
    };
  }

  return {
    id: 'ai-structured-data',
    title: 'Structured data (JSON-LD) present',
    group: 'ai',
    status: 'pass',
    detail: `${blocks.length} valid JSON-LD block(s) with @context and @type.`,
  };
}

function checkJsonLdReferences(html: string): VisibilityCheck {
  const blocks = extractJsonLdBlocks(html);
  if (blocks.length === 0) {
    return {
      id: 'ai-jsonld-references',
      title: 'JSON-LD @id references resolve',
      group: 'ai',
      status: 'fail',
      detail: 'No JSON-LD blocks to resolve @id references against.',
      fix: 'Add JSON-LD that defines entities with "@id" before referencing them as {"@id": "..."} elsewhere in the same document.',
    };
  }

  const parsedBlocks: unknown[] = [];
  for (const raw of blocks) {
    try {
      parsedBlocks.push(JSON.parse(raw));
    } catch {
      return {
        id: 'ai-jsonld-references',
        title: 'JSON-LD @id references resolve',
        group: 'ai',
        status: 'fail',
        detail: 'At least one JSON-LD block failed to parse, so @id references cannot be verified.',
        fix: 'Fix invalid JSON in <script type="application/ld+json"> before linking entities by @id.',
      };
    }
  }

  const nodes: unknown[] = [];
  for (const block of parsedBlocks) collectJsonLdNodes(block, nodes);
  const defined = definedIdsInDocument(nodes);
  const refs: string[] = [];
  for (const block of parsedBlocks) walkForBareRefs(block, refs);

  const dangling = [...new Set(refs.filter((id) => !defined.has(id)))];
  if (dangling.length > 0) {
    return {
      id: 'ai-jsonld-references',
      title: 'JSON-LD @id references resolve',
      group: 'ai',
      status: 'fail',
      detail: `Dangling @id reference(s): ${dangling.join(', ')}.`,
      fix: 'Define each referenced @id as a full node (with @type and properties) in the same JSON-LD document, or remove the bare {"@id": "..."} reference.',
    };
  }

  if (refs.length === 0) {
    return {
      id: 'ai-jsonld-references',
      title: 'JSON-LD @id references resolve',
      group: 'ai',
      status: 'pass',
      detail: 'No bare @id references present; nothing to resolve.',
    };
  }

  return {
    id: 'ai-jsonld-references',
    title: 'JSON-LD @id references resolve',
    group: 'ai',
    status: 'pass',
    detail: `All ${refs.length} bare @id reference(s) resolve within the document.`,
  };
}

function checkCrawlerAccess(robotsTxt: string | null | undefined): VisibilityCheck {
  if (robotsTxt === undefined) {
    return {
      id: 'ai-crawler-access',
      title: 'AI crawler access in robots.txt',
      group: 'ai',
      status: 'skipped',
      detail: 'robots.txt was not fetched (budget or skip).',
    };
  }

  // Absent robots.txt means no restrictions — crawlers are allowed by default.
  if (robotsTxt === null || robotsTxt.trim().length === 0) {
    return {
      id: 'ai-crawler-access',
      title: 'AI crawler access in robots.txt',
      group: 'ai',
      status: 'pass',
      detail:
        'robots.txt is absent; GPTBot, ClaudeBot, PerplexityBot, and Google-Extended are allowed by default.',
    };
  }

  const blocked = AI_CRAWLERS.filter((agent) => isCrawlerBlocked(robotsTxt, agent));
  if (blocked.length === 0) {
    return {
      id: 'ai-crawler-access',
      title: 'AI crawler access in robots.txt',
      group: 'ai',
      status: 'pass',
      detail: 'GPTBot, ClaudeBot, PerplexityBot, and Google-Extended are allowed.',
    };
  }

  // Deliberate blocks are common — report as warn, never fail.
  return {
    id: 'ai-crawler-access',
    title: 'AI crawler access in robots.txt',
    group: 'ai',
    status: 'warn',
    detail: `Blocked AI crawler(s): ${blocked.join(', ')}.`,
    fix: `To allow AI citation, remove or narrow the Disallow rules for ${blocked.join(', ')} in /robots.txt. Blocking them is often deliberate — only change this if you want those agents to read the site.`,
  };
}

function checkCanonical(html: string, finalUrl: string): VisibilityCheck {
  const href = extractCanonicalHref(html);
  if (!href || href.trim().length === 0) {
    return {
      id: 'seo-canonical',
      title: 'Canonical URL matches this page',
      group: 'search',
      status: 'fail',
      detail: 'No <link rel="canonical"> found.',
      fix: `Add <link rel="canonical" href="${finalUrl}" /> in <head>.`,
    };
  }

  if (!urlsPointAtSamePage(href, finalUrl)) {
    let resolved = href;
    try {
      resolved = new URL(href, finalUrl).toString();
    } catch {
      // keep raw href for the detail
    }
    return {
      id: 'seo-canonical',
      title: 'Canonical URL matches this page',
      group: 'search',
      status: 'fail',
      detail: `Canonical resolves to ${resolved}, which does not match ${finalUrl}.`,
      fix: `Update <link rel="canonical" href="..."> so it resolves to this page (${finalUrl}), not a different URL.`,
    };
  }

  return {
    id: 'seo-canonical',
    title: 'Canonical URL matches this page',
    group: 'search',
    status: 'pass',
    detail: `Canonical points at this page (${finalUrl}).`,
  };
}

function checkOgImage(html: string, ogImage: VisibilityInput['ogImage']): VisibilityCheck {
  const declared = extractMetaByProperty(html, 'og:image');
  if (!declared || declared.trim().length === 0) {
    return {
      id: 'seo-og-image',
      title: 'og:image is declared and reachable',
      group: 'search',
      status: 'fail',
      detail: 'No <meta property="og:image"> found.',
      fix: 'Add <meta property="og:image" content="https://…/image.png" /> pointing at a publicly reachable image/* URL.',
    };
  }

  if (ogImage === undefined) {
    return {
      id: 'seo-og-image',
      title: 'og:image is declared and reachable',
      group: 'search',
      status: 'skipped',
      detail: `og:image is declared (${declared}), but the HEAD probe was not run.`,
    };
  }

  if (ogImage === null) {
    return {
      id: 'seo-og-image',
      title: 'og:image is declared and reachable',
      group: 'search',
      status: 'fail',
      detail: `og:image is declared (${declared}) but the image URL returned nothing (absent).`,
      fix: 'Point og:image at a URL that returns HTTP 2xx with Content-Type image/*. A declared image that 404s is worse than none — crawlers cache the miss.',
    };
  }

  const okStatus = ogImage.status >= 200 && ogImage.status < 300;
  const okType =
    typeof ogImage.contentType === 'string' &&
    ogImage.contentType.toLowerCase().startsWith('image/');

  if (!okStatus || !okType) {
    return {
      id: 'seo-og-image',
      title: 'og:image is declared and reachable',
      group: 'search',
      status: 'fail',
      detail: `og:image HEAD returned status ${ogImage.status} with Content-Type ${ogImage.contentType ?? 'null'}.`,
      fix: 'Serve the og:image URL with HTTP 2xx and a Content-Type of image/* (for example image/png or image/jpeg).',
    };
  }

  return {
    id: 'seo-og-image',
    title: 'og:image is declared and reachable',
    group: 'search',
    status: 'pass',
    detail: `og:image is reachable (HTTP ${ogImage.status}, ${ogImage.contentType}).`,
  };
}

function checkTitle(html: string): VisibilityCheck {
  const title = extractTitle(html);
  if (title === null || title.length === 0) {
    return {
      id: 'seo-title',
      title: 'Document title is set',
      group: 'search',
      status: 'fail',
      detail: '<title> is missing or empty.',
      fix: `Add a non-empty <title> of at most ${TITLE_IDEAL_MAX} characters describing the page.`,
    };
  }

  if (title.length > TITLE_IDEAL_MAX) {
    return {
      id: 'seo-title',
      title: 'Document title is set',
      group: 'search',
      status: 'warn',
      detail: `<title> is ${title.length} characters (ideal ≤ ${TITLE_IDEAL_MAX}).`,
      fix: `Shorten <title> to ${TITLE_IDEAL_MAX} characters or fewer so search results do not truncate it.`,
    };
  }

  return {
    id: 'seo-title',
    title: 'Document title is set',
    group: 'search',
    status: 'pass',
    detail: `<title> is ${title.length} characters.`,
  };
}

function checkMetaDescription(html: string): VisibilityCheck {
  const description = extractMetaByName(html, 'description');
  if (description === null || description.trim().length === 0) {
    return {
      id: 'seo-meta-description',
      title: 'Meta description is set',
      group: 'search',
      status: 'fail',
      detail: '<meta name="description"> is missing or empty.',
      fix: 'Add <meta name="description" content="…"> with a concise summary of the page.',
    };
  }

  return {
    id: 'seo-meta-description',
    title: 'Meta description is set',
    group: 'search',
    status: 'pass',
    detail: `Meta description is present (${description.trim().length} characters).`,
  };
}

function checkSingleH1(html: string): VisibilityCheck {
  const count = countH1(html);
  if (count === 0) {
    return {
      id: 'seo-single-h1',
      title: 'Exactly one H1',
      group: 'search',
      status: 'fail',
      detail: 'No <h1> found.',
      fix: 'Add exactly one <h1> that names the primary topic of the page.',
    };
  }

  if (count > 1) {
    return {
      id: 'seo-single-h1',
      title: 'Exactly one H1',
      group: 'search',
      status: 'warn',
      detail: `Found ${count} <h1> elements.`,
      fix: 'Keep a single <h1> for the page topic; demote extra headings to <h2>–<h6>.',
    };
  }

  return {
    id: 'seo-single-h1',
    title: 'Exactly one H1',
    group: 'search',
    status: 'pass',
    detail: 'Exactly one <h1> found.',
  };
}

/**
 * Score AI/search readiness from already-fetched material. Pure — no I/O.
 * Produces a parallel report that must never feed Ship Gate findings.
 */
export function scanVisibility(input: VisibilityInput): VisibilityReport {
  const checks: VisibilityCheck[] = [
    checkSsrContent(input.html),
    checkLlmsTxt(input.llmsTxt),
    checkStructuredData(input.html),
    checkJsonLdReferences(input.html),
    checkCrawlerAccess(input.robotsTxt),
    checkCanonical(input.html, input.finalUrl),
    checkOgImage(input.html, input.ogImage),
    checkTitle(input.html),
    checkMetaDescription(input.html),
    checkSingleH1(input.html),
  ];

  const aiChecks = checks.filter((check) => check.group === 'ai');
  const searchChecks = checks.filter((check) => check.group === 'search');
  const aiReadinessScore = scoreChecks(aiChecks);
  const searchReadinessScore = scoreChecks(searchChecks);
  const score = scoreChecks(checks);

  return {
    checks,
    aiReadinessScore,
    searchReadinessScore,
    score,
    verdict: verdictFromScore(score),
  };
}
