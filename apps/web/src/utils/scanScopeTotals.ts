import type { ScanScopeTotals } from '@assurly/scanner-core';
import { z } from 'zod';

/**
 * Repository-wide counts the Instant Gate tree endpoint measured before capping
 * the tree. Validated here because the browser only ever holds the capped
 * sample: if these are wrong or absent the scan must fall back to the sample
 * rather than state a coverage figure it cannot support.
 */
const totalsSchema = z
  .object({
    sourceTotal: z.number().int().nonnegative(),
    surfaceSource: z.number().int().nonnegative(),
    surfaceAnalyzable: z.number().int().nonnegative(),
    partial: z.boolean().optional(),
  })
  // A surface is a subset of the repository, and analysable files a subset of
  // the surface. Anything else cannot describe one tree, so it is not trusted.
  .refine(
    (totals) =>
      totals.surfaceSource <= totals.sourceTotal &&
      totals.surfaceAnalyzable <= totals.surfaceSource,
    { message: 'scan scope totals do not describe a single tree' },
  );

/** Reads the totals from a tree response, or undefined when they are unusable. */
export function readScanScopeTotals(treeData: unknown): ScanScopeTotals | undefined {
  if (!treeData || typeof treeData !== 'object') return undefined;
  const parsed = totalsSchema.safeParse((treeData as { totals?: unknown }).totals);
  return parsed.success ? parsed.data : undefined;
}
