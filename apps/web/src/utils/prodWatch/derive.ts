import { detectAnonKeyAbuseSequence } from './detect';
import {
  classifyRequest,
  type ClassifiedRequest,
  type QueryShape,
  type RawRequestSignal,
  QUERY_SHAPES,
} from './shapes';

export type ShapeCounts = Record<QueryShape, number>;

export interface DerivedProdWatchSignal {
  bucketStartIso: string;
  shapeCounts: ShapeCounts;
  distinctTables: number;
  verdict: 'clear' | 'abuse_sequence';
  /** Classified events used for detection — never includes IP or raw line text. */
  classified: ClassifiedRequest[];
}

export interface PersistableProdWatchRow {
  bucketStart: string;
  shapeCounts: ShapeCounts;
  distinctTables: number;
  verdict: 'clear' | 'abuse_sequence' | 'not_checked';
}

/** Dotted IPv4 — four decimal octets. */
const IPV4_RE = /(?:^|[^0-9])(?:\d{1,3}\.){3}\d{1,3}(?:[^0-9]|$)/;

/** Compressed or full IPv6. Applied only after ISO-8601 times are stripped. */
const IPV6_RE = /(?:[0-9a-f]{1,4}:){2,7}[0-9a-f]{0,4}|[0-9a-f]{0,4}(?::[0-9a-f]{0,4}){1,6}::[0-9a-f]{0,4}/i;

const ISO_TIME_RE = /T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z/gi;

const FORBIDDEN_KEYS = ['event_message', 'raw_log', 'client_ip', 'x_real_ip', 'user_agent'] as const;

/**
 * Refuse values that embed an IP or a raw log field. Defense in depth — callers
 * must not put raw fields in shapeCounts; the persistence test asserts this.
 * ISO bucket timestamps are stripped before the IPv6 check so `HH:MM:SS` cannot
 * false-positive.
 */
export function assertSafeForPersistence(value: unknown): void {
  if (!value || typeof value !== 'object') {
    throw new Error('Prod Watch refused to persist a non-object signal.');
  }
  const keys = Object.keys(value as object);
  for (const key of keys) {
    if ((FORBIDDEN_KEYS as readonly string[]).includes(key)) {
      throw new Error('Prod Watch refused to persist a raw log field.');
    }
  }

  const json = JSON.stringify(value);
  for (const forbidden of FORBIDDEN_KEYS) {
    if (json.includes(forbidden)) {
      throw new Error('Prod Watch refused to persist a raw log field.');
    }
  }
  if (IPV4_RE.test(json)) {
    throw new Error('Prod Watch refused to persist an IP address.');
  }
  const withoutIsoTimes = json.replace(ISO_TIME_RE, '');
  if (IPV6_RE.test(withoutIsoTimes)) {
    throw new Error('Prod Watch refused to persist an IP address.');
  }
}

export function emptyShapeCounts(): ShapeCounts {
  return {
    schema_introspection: 0,
    table_enumeration: 0,
    bulk_read: 0,
    other: 0,
  };
}

/**
 * Derive the persistable signal from ephemeral request metadata.
 * Raw log lines (if the caller held them) must already have been discarded;
 * this function only accepts the narrow RawRequestSignal shape.
 */
export function deriveProdWatchSignal(
  requests: readonly RawRequestSignal[],
  bucketStart: Date = floorToBucket(new Date()),
): DerivedProdWatchSignal {
  const classified = requests.map(classifyRequest);
  const shapeCounts = emptyShapeCounts();
  const tables = new Set<string>();

  for (const event of classified) {
    shapeCounts[event.shape] += 1;
    if (event.table) tables.add(event.table);
  }

  const detection = detectAnonKeyAbuseSequence(classified);
  const derived: DerivedProdWatchSignal = {
    bucketStartIso: bucketStart.toISOString(),
    shapeCounts,
    distinctTables: tables.size,
    verdict: detection.detected ? 'abuse_sequence' : 'clear',
    classified,
  };

  assertSafeForPersistence(toPersistableRow(derived));
  return derived;
}

export function toPersistableRow(derived: DerivedProdWatchSignal): PersistableProdWatchRow {
  // Explicit allow-list — never spread arbitrary fields from the derived object.
  const row: PersistableProdWatchRow = {
    bucketStart: derived.bucketStartIso,
    shapeCounts: { ...derived.shapeCounts },
    distinctTables: derived.distinctTables,
    verdict: derived.verdict,
  };
  // Drop any accidental keys that are not in QUERY_SHAPES.
  for (const key of Object.keys(row.shapeCounts)) {
    if (!(QUERY_SHAPES as readonly string[]).includes(key)) {
      delete (row.shapeCounts as Record<string, number>)[key];
    }
  }
  return row;
}

/** 5-minute buckets keep cardinality low without needing per-request storage. */
export function floorToBucket(date: Date, bucketMs = 5 * 60 * 1000): Date {
  return new Date(Math.floor(date.getTime() / bucketMs) * bucketMs);
}

/**
 * Map a Management API log row (untrusted) into RawRequestSignal or null.
 * Deliberately ignores IP / UA / headers / event_message body text — even if
 * the upstream payload contains them.
 */
export function requestSignalFromLogRow(row: unknown): RawRequestSignal | null {
  if (!row || typeof row !== 'object') return null;
  const record = row as Record<string, unknown>;
  const attrs =
    record.log_attributes && typeof record.log_attributes === 'object'
      ? (record.log_attributes as Record<string, unknown>)
      : null;

  const path =
    readString(record, 'path') ??
    readString(record, 'request_path') ??
    readString(record, 'pathname') ??
    (attrs ? readString(attrs, 'request.path') ?? readString(attrs, 'path') : null);

  const method =
    readString(record, 'method') ??
    readString(record, 'request_method') ??
    (attrs ? readString(attrs, 'request.method') ?? readString(attrs, 'method') : null) ??
    'GET';

  const at = pickTimestamp(record);
  if (!path || at === null) return null;

  const status =
    readNumber(record, 'status_code') ??
    readNumber(record, 'status') ??
    readNumber(record, 'response_status_code') ??
    (attrs
      ? readNumber(attrs, 'response.status_code') ?? readNumber(attrs, 'status_code')
      : null);

  return {
    at,
    method,
    path,
    status: status ?? undefined,
    bulkHint: pickBulkHint(record),
  };
}

function readString(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function readNumber(record: Record<string, unknown>, key: string): number | null {
  const value = record[key];
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return null;
}

function pickTimestamp(record: Record<string, unknown>): number | null {
  const value = record.timestamp ?? record.ts ?? record.time;
  if (typeof value === 'number' && Number.isFinite(value)) {
    // Supabase often uses microseconds.
    return value > 1e14 ? Math.floor(value / 1000) : value;
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function pickBulkHint(record: Record<string, unknown>): boolean {
  if (record.bulk_hint === true || record.bulkHint === true) return true;
  const prefer = record.prefer ?? record.Prefer;
  if (typeof prefer === 'string' && /count\s*=\s*exact/i.test(prefer)) return true;
  const range = record.range ?? record.Range;
  if (typeof range === 'string') {
    const match = range.match(/(\d+)\s*-\s*(\d+)/);
    if (match) {
      const start = Number(match[1]);
      const end = Number(match[2]);
      if (Number.isFinite(start) && Number.isFinite(end) && end - start >= 100) return true;
    }
  }
  return false;
}
