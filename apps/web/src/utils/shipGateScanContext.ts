/**
 * Resolve Ship Gate scan scope + file counts for the detail panel.
 * Persisted scan SoT always wins over in-session Instant Gate overrides so a
 * prior repo's scope cannot leak after switching repositories.
 */

export interface ShipGateScanScope {
  scanned: number;
  skipped: number;
  roots: string[];
}

export interface ShipGateScanContextSession {
  lastScanScope: ShipGateScanScope | null;
  lastScanFileCount: number | null;
}

export interface ShipGateScanContextScan {
  scan_scope?: Record<string, unknown> | null;
  scanned_file_count?: number | null;
}

export interface ResolvedShipGateScanContext {
  scanScope: ShipGateScanScope | null;
  scannedFileCount: number | null;
}

function parseScanScope(raw: unknown): ShipGateScanScope | null {
  if (!raw || typeof raw !== 'object') return null;
  const record = raw as Record<string, unknown>;
  if (typeof record.scanned !== 'number') return null;
  return {
    scanned: record.scanned,
    skipped: typeof record.skipped === 'number' ? record.skipped : 0,
    roots: Array.isArray(record.roots)
      ? record.roots.filter((root): root is string => typeof root === 'string')
      : ['repository'],
  };
}

/** Prefer persisted scan columns; fall back to the current Instant Gate session. */
export function resolveShipGateScanContext(
  scan: ShipGateScanContextScan | null | undefined,
  session: ShipGateScanContextSession,
): ResolvedShipGateScanContext {
  const fromScan = parseScanScope(scan?.scan_scope ?? null);
  const scannedFromScan =
    typeof scan?.scanned_file_count === 'number' ? scan.scanned_file_count : null;

  return {
    scanScope: fromScan ?? session.lastScanScope,
    scannedFileCount: scannedFromScan ?? session.lastScanFileCount,
  };
}
