/**
 * Classify Supabase API request paths into abuse-relevant query shapes.
 * Pure — no I/O. Input is already stripped to method/path/status/range hints.
 */

export const QUERY_SHAPES = [
  'schema_introspection',
  'table_enumeration',
  'bulk_read',
  'other',
] as const;

export type QueryShape = (typeof QUERY_SHAPES)[number];

export interface RawRequestSignal {
  /** Unix ms. */
  at: number;
  method: string;
  /** Request path only, e.g. /rest/v1/users — never a full URL with query secrets. */
  path: string;
  status?: number;
  /** True when Prefer: count=exact or a wide Range header was present. */
  bulkHint?: boolean;
}

export interface ClassifiedRequest {
  at: number;
  shape: QueryShape;
  /** First path segment under /rest/v1/ when relevant (table name). */
  table?: string;
}

const REST_ROOT = /^\/rest\/v1\/?$/i;
const REST_TABLE = /^\/rest\/v1\/([a-zA-Z_][a-zA-Z0-9_]*)\/?$/;

export function classifyRequest(signal: RawRequestSignal): ClassifiedRequest {
  const method = signal.method.toUpperCase();
  const path = sanitizePath(signal.path);

  if (method === 'GET' && REST_ROOT.test(path)) {
    return { at: signal.at, shape: 'schema_introspection' };
  }

  const tableMatch = path.match(REST_TABLE);
  if (method === 'GET' && tableMatch) {
    const table = tableMatch[1]!.toLowerCase();
    if (signal.bulkHint === true || isBulkStatus(signal.status)) {
      return { at: signal.at, shape: 'bulk_read', table };
    }
    return { at: signal.at, shape: 'table_enumeration', table };
  }

  return { at: signal.at, shape: 'other' };
}

function isBulkStatus(status: number | undefined): boolean {
  // 206 Partial Content often accompanies Range-based bulk reads.
  return status === 206;
}

/** Drop query string and fragments so secrets in filters never enter classification. */
export function sanitizePath(rawPath: string): string {
  const withoutQuery = rawPath.split('?')[0] ?? rawPath;
  const withoutHash = withoutQuery.split('#')[0] ?? withoutQuery;
  if (!withoutHash.startsWith('/')) return `/${withoutHash}`;
  return withoutHash;
}
