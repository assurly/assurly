import { describe, expect, it } from 'vitest';
import { resolveShipGateScanContext } from './shipGateScanContext';

describe('resolveShipGateScanContext', () => {
  const staleSession = {
    lastScanScope: {
      scanned: 250,
      skipped: 10,
      roots: ['apps/docs', 'packages/adapter-flagsmith'],
    },
    lastScanFileCount: 250,
  };

  it('prefers persisted scan SoT over a stale Instant Gate session', () => {
    const resolved = resolveShipGateScanContext(
      {
        scan_scope: { scanned: 71, skipped: 0, roots: ['repository'] },
        scanned_file_count: 71,
      },
      staleSession,
    );

    expect(resolved.scanScope).toEqual({
      scanned: 71,
      skipped: 0,
      roots: ['repository'],
    });
    expect(resolved.scannedFileCount).toBe(71);
  });

  it('falls back to session when the scan row has no SoT columns', () => {
    const resolved = resolveShipGateScanContext(
      { scan_scope: null, scanned_file_count: null },
      staleSession,
    );

    expect(resolved.scanScope).toEqual(staleSession.lastScanScope);
    expect(resolved.scannedFileCount).toBe(250);
  });

  it('returns nulls when neither scan nor session has coverage data', () => {
    expect(
      resolveShipGateScanContext(null, {
        lastScanScope: null,
        lastScanFileCount: null,
      }),
    ).toEqual({ scanScope: null, scannedFileCount: null });
  });

  it('ignores malformed scan_scope objects and uses session instead', () => {
    const resolved = resolveShipGateScanContext(
      { scan_scope: { roots: ['apps/web'] }, scanned_file_count: 12 },
      staleSession,
    );
    expect(resolved.scanScope).toEqual(staleSession.lastScanScope);
    expect(resolved.scannedFileCount).toBe(12);
  });
});
