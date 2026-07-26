import { NextResponse } from 'next/server';
import { z } from 'zod';
import { DEP_DEFAULT_EVAL_CAP } from '@assurly/scanner-core';
import {
  emptyObjectSchema,
  RATE_LIMITS,
  requireRouteUser,
  secureRoute,
} from '../../../../utils/apiSecurity';
import { getAdminDbAdapter } from '../../../../utils/dbAdapter';
import {
  createDbNpmCacheStore,
  evaluateNamedDependencies,
} from '../../../../utils/dependencyProvenanceLookup';

/**
 * npm package names — scoped (@scope/name) or bare. Cap body size so a large
 * manifest cannot fan the request into hundreds of lookups; evaluation still
 * applies DEP_DEFAULT_EVAL_CAP independently.
 */
const packageNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(214)
  .refine((value) => !value.includes('\0') && !/\s/.test(value), {
    message: 'Invalid package name.',
  });

const provenanceBody = z
  .object({
    packages: z.array(packageNameSchema).max(500),
    manifestPath: z
      .string()
      .trim()
      .min(1)
      .max(1024)
      .refine(
        (value) =>
          !value.split('/').some((part) => !part || part === '.' || part === '..') &&
          !value.includes('\\') &&
          !value.startsWith('/'),
      )
      .optional(),
  })
  .strict();

/**
 * Server-side dependency provenance proxy for dashboard repo scans.
 *
 * The browser must not hit the npm registry directly (CORS, visitor rate
 * limits, bypassed Postgres cache). Auth is required; cache writes use the
 * service-role adapter (npm_package_cache is service-role-only by RLS).
 */
export const POST = secureRoute(
  {
    routeId: 'dependencies:provenance',
    auth: 'required',
    csrf: true,
    query: emptyObjectSchema,
    params: emptyObjectSchema,
    body: provenanceBody,
    bodyMode: 'json',
    maxBodyBytes: 64 * 1024,
    rateLimit: RATE_LIMITS.expensive,
  },
  async ({ auth, body }) => {
    // Auth gate — we do not use the user-scoped adapter for the cache.
    requireRouteUser(auth);

    const adminDb = getAdminDbAdapter();
    const result = await evaluateNamedDependencies({
      packageNames: body.packages,
      manifestPath: body.manifestPath ?? 'package.json',
      cap: DEP_DEFAULT_EVAL_CAP,
      cache: createDbNpmCacheStore(adminDb),
    });

    return NextResponse.json({
      evaluatedDependencies: result.evaluatedDependencies,
      findings: result.findings.map((finding) => ({
        ruleId: finding.ruleId,
        severity: finding.severity,
        confidence: finding.confidence,
        file: finding.file,
        line: finding.line,
        message: finding.message,
        suggestion: finding.suggestion,
      })),
    });
  },
);
