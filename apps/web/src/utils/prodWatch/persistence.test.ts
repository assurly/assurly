import { describe, expect, it } from 'vitest';
import {
  assertSafeForPersistence,
  deriveProdWatchSignal,
  requestSignalFromLogRow,
  toPersistableRow,
} from './derive';

/**
 * Persistence contract: fixtures intentionally contain obvious IPs and raw log
 * lines. Nothing that looks like an IP or a raw log field may appear in the
 * persistable row. Prove-red: temporarily weaken toPersistableRow / derive to
 * include `client_ip` from the fixture and this test must fail.
 */
describe('Prod Watch persistence — no IP / no raw log line', () => {
  const toxicFixtures = [
    {
      timestamp: '2026-07-26T12:00:00.000Z',
      method: 'GET',
      path: '/rest/v1/',
      status_code: 200,
      // Toxic fields that must never be persisted:
      client_ip: '203.0.113.55',
      event_message: 'GET /rest/v1/ from 203.0.113.55',
      x_real_ip: '2001:db8::1',
      raw_log: 'edge request ip=203.0.113.55 ua=curl/8.0',
    },
    {
      timestamp: '2026-07-26T12:00:10.000Z',
      method: 'GET',
      path: '/rest/v1/users',
      status_code: 200,
      client_ip: '198.51.100.10',
      event_message: 'table scan from 198.51.100.10',
    },
    {
      timestamp: '2026-07-26T12:00:20.000Z',
      method: 'GET',
      path: '/rest/v1/orders',
      status_code: 200,
      client_ip: '192.0.2.44',
    },
    {
      timestamp: '2026-07-26T12:00:30.000Z',
      method: 'GET',
      path: '/rest/v1/payments',
      status_code: 200,
      client_ip: '203.0.113.99',
    },
    {
      timestamp: '2026-07-26T12:00:40.000Z',
      method: 'GET',
      path: '/rest/v1/users',
      status_code: 206,
      bulkHint: true,
      client_ip: '203.0.113.55',
      event_message: 'Range 0-999 from 203.0.113.55',
    },
  ];

  it('strips toxic fields when mapping log rows', () => {
    for (const fixture of toxicFixtures) {
      const signal = requestSignalFromLogRow(fixture);
      expect(signal).not.toBeNull();
      const json = JSON.stringify(signal);
      expect(json).not.toMatch(/\b(?:\d{1,3}\.){3}\d{1,3}\b/);
      expect(json).not.toMatch(/203\.0\.113/);
      expect(json).not.toContain('event_message');
      expect(json).not.toContain('raw_log');
      expect(json).not.toContain('client_ip');
    }
  });

  it('persistable derived row contains no IP and no raw log line', () => {
    const requests = toxicFixtures
      .map((row) => requestSignalFromLogRow(row))
      .filter((row): row is NonNullable<typeof row> => row !== null)
      .map((row, index) =>
        index === toxicFixtures.length - 1 ? { ...row, bulkHint: true } : row,
      );

    const derived = deriveProdWatchSignal(requests);
    const persistable = toPersistableRow(derived);

    expect(() => assertSafeForPersistence(persistable)).not.toThrow();

    const json = JSON.stringify(persistable);
    expect(json).not.toMatch(/\b(?:\d{1,3}\.){3}\d{1,3}\b/);
    expect(json).not.toMatch(/2001:db8/i);
    expect(json).not.toContain('event_message');
    expect(json).not.toContain('raw_log');
    expect(json).not.toContain('client_ip');
    expect(json).not.toContain('203.0.113');
    expect(persistable.verdict).toBe('abuse_sequence');
    expect(persistable.shapeCounts.schema_introspection).toBeGreaterThanOrEqual(1);
  });

  it('assertSafeForPersistence rejects a buggy row that embeds an IP', () => {
    expect(() =>
      assertSafeForPersistence({
        bucketStart: '2026-07-26T12:00:00.000Z',
        shapeCounts: { schema_introspection: 1 },
        // Intentionally toxic — simulates the exact bug the persistence test catches.
        leaked: '203.0.113.55',
      }),
    ).toThrow(/IP address/);

    expect(() =>
      assertSafeForPersistence({
        bucketStart: '2026-07-26T12:00:00.000Z',
        shapeCounts: { schema_introspection: 1 },
        client_ip: 'redacted-but-field-forbidden',
      }),
    ).toThrow(/raw log field/);
  });
});
