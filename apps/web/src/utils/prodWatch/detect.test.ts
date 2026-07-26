import { describe, expect, it } from 'vitest';
import { detectAnonKeyAbuseSequence } from './detect';
import type { ClassifiedRequest } from './shapes';

const t0 = Date.parse('2026-07-26T12:00:00.000Z');

function evt(
  offsetMs: number,
  shape: ClassifiedRequest['shape'],
  table?: string,
): ClassifiedRequest {
  return { at: t0 + offsetMs, shape, table };
}

describe('detectAnonKeyAbuseSequence', () => {
  it('fires on the full schema → enumerate → bulk sequence', () => {
    const events = [
      evt(0, 'schema_introspection'),
      evt(30_000, 'table_enumeration', 'users'),
      evt(40_000, 'table_enumeration', 'orders'),
      evt(50_000, 'table_enumeration', 'payments'),
      evt(60_000, 'bulk_read', 'users'),
    ];
    const result = detectAnonKeyAbuseSequence(events);
    expect(result.detected).toBe(true);
    expect(result.enumeratedTables).toBeGreaterThanOrEqual(3);
  });

  it('does not fire on schema introspection alone', () => {
    expect(
      detectAnonKeyAbuseSequence([
        evt(0, 'schema_introspection'),
        evt(10_000, 'other'),
      ]).detected,
    ).toBe(false);
  });

  it('does not fire on table enumeration without prior schema introspection', () => {
    expect(
      detectAnonKeyAbuseSequence([
        evt(0, 'table_enumeration', 'users'),
        evt(10_000, 'table_enumeration', 'orders'),
        evt(20_000, 'table_enumeration', 'payments'),
        evt(30_000, 'bulk_read', 'users'),
      ]).detected,
    ).toBe(false);
  });

  it('does not fire when bulk read is missing', () => {
    expect(
      detectAnonKeyAbuseSequence([
        evt(0, 'schema_introspection'),
        evt(10_000, 'table_enumeration', 'a'),
        evt(20_000, 'table_enumeration', 'b'),
        evt(30_000, 'table_enumeration', 'c'),
      ]).detected,
    ).toBe(false);
  });

  it('does not fire on ordinary high-volume app traffic', () => {
    const events: ClassifiedRequest[] = [];
    for (let i = 0; i < 200; i += 1) {
      events.push(evt(i * 1000, 'table_enumeration', 'sessions'));
      events.push(evt(i * 1000 + 100, 'other'));
    }
    expect(detectAnonKeyAbuseSequence(events).detected).toBe(false);
  });

  it('does not fire when steps are outside the sequence window', () => {
    expect(
      detectAnonKeyAbuseSequence([
        evt(0, 'schema_introspection'),
        evt(20 * 60 * 1000, 'table_enumeration', 'a'),
        evt(21 * 60 * 1000, 'table_enumeration', 'b'),
        evt(22 * 60 * 1000, 'table_enumeration', 'c'),
        evt(23 * 60 * 1000, 'bulk_read', 'a'),
      ]).detected,
    ).toBe(false);
  });
});
