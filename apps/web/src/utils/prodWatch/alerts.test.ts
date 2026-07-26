import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DbAdapter, ProdWatchIncidentRow } from '../dbAdapter';
import { decideProdWatchAlert } from './alerts';
import { PROD_WATCH_ABUSE_RULE_ID, PROD_WATCH_ALERT_COLLAPSE_MS } from './constants';

function mockDb(open: ProdWatchIncidentRow | null = null): DbAdapter {
  const state = { open };
  return {
    getOpenProdWatchIncident: vi.fn(async () => state.open),
    closeProdWatchIncident: vi.fn(async () => {
      state.open = null;
    }),
    touchProdWatchIncident: vi.fn(async () => undefined),
    upsertOpenProdWatchIncident: vi.fn(async (input) => {
      const row: ProdWatchIncidentRow = {
        id: state.open?.id ?? 'inc-1',
        organization_id: input.organizationId,
        target_id: input.targetId,
        rule_id: input.ruleId,
        status: 'open',
        first_seen_at: state.open?.first_seen_at ?? input.lastSeenAt,
        last_seen_at: input.lastSeenAt,
        last_alerted_at: input.lastAlertedAt,
        alert_count: (state.open?.alert_count ?? 0) + 1,
      };
      state.open = row;
      return row;
    }),
  } as unknown as DbAdapter;
}

describe('decideProdWatchAlert — collapse ongoing incidents', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('fires once for a new detection', async () => {
    const db = mockDb(null);
    const first = await decideProdWatchAlert({
      db,
      organizationId: 'org-1',
      targetId: 'target-1',
      detected: true,
      nowMs: 1_000_000,
    });
    expect(first).toEqual({ shouldAlert: true, reason: 'fire', incidentId: 'inc-1' });
  });

  it('collapses a second detection inside the cooldown into one alert', async () => {
    const db = mockDb({
      id: 'inc-1',
      organization_id: 'org-1',
      target_id: 'target-1',
      rule_id: PROD_WATCH_ABUSE_RULE_ID,
      status: 'open',
      first_seen_at: new Date(1_000_000).toISOString(),
      last_seen_at: new Date(1_000_000).toISOString(),
      last_alerted_at: new Date(1_000_000).toISOString(),
      alert_count: 1,
    });

    const second = await decideProdWatchAlert({
      db,
      organizationId: 'org-1',
      targetId: 'target-1',
      detected: true,
      nowMs: 1_000_000 + PROD_WATCH_ALERT_COLLAPSE_MS - 1,
    });
    expect(second.shouldAlert).toBe(false);
    expect(second.reason).toBe('collapsed');
    expect(db.upsertOpenProdWatchIncident).not.toHaveBeenCalled();
    expect(db.touchProdWatchIncident).toHaveBeenCalled();
  });

  it('closes the incident when the sequence is no longer detected', async () => {
    const db = mockDb({
      id: 'inc-1',
      organization_id: 'org-1',
      target_id: 'target-1',
      rule_id: PROD_WATCH_ABUSE_RULE_ID,
      status: 'open',
      first_seen_at: new Date(0).toISOString(),
      last_seen_at: new Date(0).toISOString(),
      last_alerted_at: new Date(0).toISOString(),
      alert_count: 1,
    });
    const result = await decideProdWatchAlert({
      db,
      organizationId: 'org-1',
      targetId: 'target-1',
      detected: false,
    });
    expect(result.reason).toBe('no_sequence');
    expect(db.closeProdWatchIncident).toHaveBeenCalledWith({
      targetId: 'target-1',
      ruleId: PROD_WATCH_ABUSE_RULE_ID,
    });
  });
});
