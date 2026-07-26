import { describe, expect, it } from 'vitest';
import { deriveProdWatchSignal, toPersistableRow } from './derive';

/**
 * Independent probe, not derived from the implementation's own assumptions:
 * plant identifiers in every field of a realistic log batch and assert none of
 * them survive into what is written.
 */
describe('independent leak probe', () => {
  it('lets no planted identifier reach the persisted row', () => {
    const planted = [
      '203.0.113.77',
      '2001:db8::dead:beef',
      'attacker@example.com',
      'Mozilla/5.0 PLANTED-UA',
      'Bearer PLANTEDTOKEN',
      'user_9f3a1c',
    ];

    const entries = Array.from({ length: 40 }, (_, index) => ({
      timestamp: new Date(Date.UTC(2026, 6, 26, 6, 0, index % 60)).toISOString(),
      path: index < 5 ? '/rest/v1/' : `/rest/v1/table_${index % 7}`,
      method: 'GET',
      status: 200,
      client_ip: planted[0],
      client_ipv6: planted[1],
      user_email: planted[2],
      user_agent: planted[3],
      authorization: planted[4],
      user_id: planted[5],
      request_id: `req-${index}`,
      raw: `${planted[0]} ${planted[3]} ${planted[4]}`,
    })) as unknown as Parameters<typeof deriveProdWatchSignal>[0];

    const derived = deriveProdWatchSignal(entries);
    const row = toPersistableRow(derived);
    const serialized = JSON.stringify(row);

    for (const secret of planted) {
      expect(serialized, `planted value leaked into persisted row: ${secret}`).not.toContain(
        secret,
      );
    }
    // Also catch partial leakage: no octet run that looks like the planted IP.
    expect(serialized).not.toMatch(/203\.0\.113/);
    expect(serialized).not.toMatch(/PLANTED/i);
  });
});
