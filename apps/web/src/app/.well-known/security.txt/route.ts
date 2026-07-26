import { disclosureContactUrl } from '../../../utils/disclosureContact';
import { getApplicationUrl } from '../../../utils/env';

/**
 * RFC 9116 security.txt — the machine-readable half of the coordinated
 * vulnerability disclosure policy published on /trust.
 *
 * Served from a route handler rather than a static file for two reasons: the
 * canonical URL follows APP_URL across environments, and `Expires` is computed
 * on each request. RFC 9116 requires an expiry under a year, and a hardcoded one
 * silently rots — a stale security.txt tells a researcher the contact is
 * abandoned, which is worse than not publishing one at all.
 *
 * Contact must stay aligned with Trust §13 and
 * docs/runbooks/cra-actively-exploited-vulnerability-reporting.md — see
 * craContactConsistency.test.ts.
 */

/** How long a served file claims to stay valid. Well inside RFC 9116's one-year ceiling. */
const VALIDITY_DAYS = 180;

export const dynamic = 'force-dynamic';

export function GET(): Response {
  const appUrl = getApplicationUrl().replace(/\/$/, '');
  const expires = new Date(Date.now() + VALIDITY_DAYS * 24 * 60 * 60 * 1000).toISOString();

  const body = [
    '# Assurly — coordinated vulnerability disclosure',
    '# Full policy, scope, and safe harbour: ' + `${appUrl}/trust`,
    '',
    `Contact: ${disclosureContactUrl(appUrl)}`,
    `Policy: ${appUrl}/trust`,
    `Expires: ${expires}`,
    'Preferred-Languages: en, sk',
    '',
    '# In scope: the Assurly web application and API, the assurly,',
    '# @assurly/scanner-core, and @assurly/mcp-server packages, the GitHub App,',
    '# and the MCP server. Out of scope: our subprocessors’ own infrastructure',
    '# and our customers’ applications.',
    '',
  ].join('\n');

  return new Response(body, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
    },
  });
}
