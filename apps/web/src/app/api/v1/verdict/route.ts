import { NextResponse } from 'next/server';
import { z } from 'zod';
import { ApiError, RATE_LIMITS, requireApiKey, secureRoute } from '../../../../utils/apiSecurity';
import { getAdminDbAdapter } from '../../../../utils/dbAdapter';
import { getApplicationUrl } from '../../../../utils/env';
import { normalizeUrlIdentifier } from '../../../../utils/ownership/gate';
import { resolveProgrammaticVerdict } from '../../../../utils/programmaticVerdict';

const REPO_PATTERN = /^[^/\s]+\/[^/\s]+$/;

/**
 * Query accepts exactly one of `url` or `repo`. `url` must be an http(s) URL
 * (pinned to its origin server-side); `repo` is `owner/name`.
 */
const verdictQuery = z
  .object({
    url: z.string().url().max(2048).optional(),
    repo: z.string().max(256).regex(REPO_PATTERN).optional(),
  })
  .strict()
  .refine((value) => Boolean(value.url) !== Boolean(value.repo), {
    message: 'Provide exactly one of `url` or `repo`.',
  });

function appBaseUrl(): string | null {
  try {
    return getApplicationUrl();
  } catch {
    return null;
  }
}

/**
 * Programmatic, keyed verdict API (Phase 7 + Proof-of-Fix) — the read-only
 * surface the MCP `assurly_verdict` tool and OEM callers hit.
 *
 * READ-ONLY and SHAPE-ONLY: it reads one target row (and stored fix outcomes)
 * for the key's org and projects them through `toPublicTrustProjection` plus
 * per-rule `{ ruleId, outcome, observedAt }` — never evidence, PII, finding
 * messages, file paths, or the exposed table name. It NEVER triggers an active
 * probe: resolution goes through the ownership gate (`isActiveProbeAllowed`)
 * but has no probe/scan/re-probe code path, so a stranger/unverified URL can
 * only ever get the passive verdict.
 */
export const GET = secureRoute(
  {
    routeId: 'v1:verdict',
    auth: 'apiKey',
    query: verdictQuery,
    params: z.object({}).strict(),
    body: z.undefined(),
    bodyMode: 'none',
    maxBodyBytes: 0,
    // IP guard; the binding quota is the plan-based key limit inside secureRoute.
    rateLimit: RATE_LIMITS.read,
  },
  async ({ apiKey, query }) => {
    const key = requireApiKey(apiKey);

    let kind: 'repo' | 'url';
    let identifier: string;
    if (query.url) {
      kind = 'url';
      try {
        identifier = normalizeUrlIdentifier(query.url);
      } catch {
        throw new ApiError(400, 'invalid_request', 'Request validation failed.');
      }
    } else {
      kind = 'repo';
      identifier = query.repo as string;
    }

    // Service role + explicit org filter (getTargetByIdentifier scopes by org),
    // so the lookup is confined to the key's organization — never cross-org.
    const db = getAdminDbAdapter();
    const verdict = await resolveProgrammaticVerdict(
      db,
      key.organizationId,
      { kind, identifier },
      appBaseUrl(),
    );

    return NextResponse.json(verdict);
  },
);
