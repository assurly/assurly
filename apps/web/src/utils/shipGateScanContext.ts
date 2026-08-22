/**
 * Resolve Ship Gate scan scope + file counts for the detail panel.
 * Persisted scan SoT always wins over in-session Instant Gate overrides so a
 * prior repo's scope cannot leak after switching repositories.
 */

export interface ShipGateScanScope {
  scanned: number;
  skipped: number;
  roots: string[];
  unanalyzed?: Array<{ language: string; fileCount: number }>;
  sourceTotal?: number;
  limit?: number;
  gaps?: {
    notAnalysed: number;
    overLimit: number;
    outsideAppRoots: number;
  };
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

function parseUnanalyzed(raw: unknown): ShipGateScanScope['unanalyzed'] {
  if (!Array.isArray(raw)) return undefined;
  const items = raw.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return [];
    const record = entry as Record<string, unknown>;
    if (typeof record.language !== 'string' || typeof record.fileCount !== 'number') return [];
    return [{ language: record.language, fileCount: record.fileCount }];
  });
  return items.length > 0 ? items : undefined;
}

function parseGaps(raw: unknown): ShipGateScanScope['gaps'] {
  if (!raw || typeof raw !== 'object') return undefined;
  const record = raw as Record<string, unknown>;
  if (
    typeof record.notAnalysed !== 'number' ||
    typeof record.overLimit !== 'number' ||
    typeof record.outsideAppRoots !== 'number'
  ) {
    return undefined;
  }
  return {
    notAnalysed: record.notAnalysed,
    overLimit: record.overLimit,
    outsideAppRoots: record.outsideAppRoots,
  };
}

function parseScanScope(raw: unknown): ShipGateScanScope | null {
  if (!raw || typeof raw !== 'object') return null;
  const record = raw as Record<string, unknown>;
  if (typeof record.scanned !== 'number') return null;
  const unanalyzed = parseUnanalyzed(record.unanalyzed);
  const gaps = parseGaps(record.gaps);
  return {
    scanned: record.scanned,
    skipped: typeof record.skipped === 'number' ? record.skipped : 0,
    roots: Array.isArray(record.roots)
      ? record.roots.filter((root): root is string => typeof root === 'string')
      : ['repository'],
    ...(unanalyzed ? { unanalyzed } : {}),
    ...(typeof record.sourceTotal === 'number' ? { sourceTotal: record.sourceTotal } : {}),
    ...(typeof record.limit === 'number' ? { limit: record.limit } : {}),
    ...(gaps ? { gaps } : {}),
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
