import {
  PROD_WATCH_MIN_ENUMERATED_TABLES,
  PROD_WATCH_SEQUENCE_WINDOW_MS,
} from './constants';
import type { ClassifiedRequest } from './shapes';

export interface AbuseSequenceDetection {
  detected: boolean;
  /** Inclusive window that contained the sequence, when detected. */
  windowStartMs?: number;
  windowEndMs?: number;
  enumeratedTables?: number;
}

/**
 * Detect the documented anon-key abuse sequence:
 *   schema introspection → table enumeration (≥ N distinct tables) → bulk read
 * within PROD_WATCH_SEQUENCE_WINDOW_MS.
 *
 * Partial sequences and high-volume ordinary app traffic (table reads without
 * prior schema introspection, or introspection without enumeration+bulk) do not
 * fire. Pure function — no I/O.
 */
export function detectAnonKeyAbuseSequence(
  events: readonly ClassifiedRequest[],
  options?: {
    windowMs?: number;
    minTables?: number;
  },
): AbuseSequenceDetection {
  const windowMs = options?.windowMs ?? PROD_WATCH_SEQUENCE_WINDOW_MS;
  const minTables = options?.minTables ?? PROD_WATCH_MIN_ENUMERATED_TABLES;

  if (events.length === 0) return { detected: false };

  const sorted = [...events].sort((a, b) => a.at - b.at);
  const introspectionTimes = sorted
    .filter((event) => event.shape === 'schema_introspection')
    .map((event) => event.at);

  for (const start of introspectionTimes) {
    const end = start + windowMs;
    const inWindow = sorted.filter((event) => event.at >= start && event.at <= end);

    const tables = new Set<string>();
    let sawBulk = false;
    for (const event of inWindow) {
      if (event.shape === 'table_enumeration' && event.table) {
        tables.add(event.table);
      }
      if (event.shape === 'bulk_read') {
        // Bulk reads also count as having touched that table.
        if (event.table) tables.add(event.table);
        sawBulk = true;
      }
    }

    if (tables.size >= minTables && sawBulk) {
      return {
        detected: true,
        windowStartMs: start,
        windowEndMs: end,
        enumeratedTables: tables.size,
      };
    }
  }

  return { detected: false };
}
