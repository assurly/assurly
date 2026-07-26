import { describe, expect, it, vi } from 'vitest';
import type { DbAdapter, ProdWatchSubscription, Target } from '../dbAdapter';
import { runProdWatchBatch } from './batch';
import { encryptProdWatchToken } from './crypto';

const target: Target = {
  id: '11111111-1111-1111-1111-111111111111',
  organization_id: '22222222-2222-2222-2222-222222222222',
  kind: 'url',
  identifier: 'https://example.com',
  display_name: 'Example',
  repository_id: null,
  generator_fingerprint: null,
  ownership_verified: true,
  ownership_method: 'meta_tag',
  current_verdict: 'ready',
  current_ship_score: 100,
  verdict_evidence: null,
  last_checked_at: null,
  badge_token: null,
  created_at: new Date(0).toISOString(),
  updated_at: new Date(0).toISOString(),
};

function subscription(): ProdWatchSubscription {
  return {
    id: 'sub-1',
    organization_id: target.organization_id,
    target_id: target.id,
    enabled: true,
    supabase_project_ref: 'abcdefghijklmnopqr',
    access_token_ciphertext: encryptProdWatchToken('sbp_test_token_value_12345'),
    last_checked_at: null,
    last_status: 'never',
    last_error: null,
    created_at: new Date(0).toISOString(),
    updated_at: new Date(0).toISOString(),
  };
}

describe('runProdWatchBatch degradation', () => {
  it('does not fail the batch when the customer project is unreachable', async () => {
    const previous = process.env.ASSURLY_PROD_WATCH_ENABLED;
    process.env.ASSURLY_PROD_WATCH_ENABLED = '1';

    const sub = subscription();
    const db = {
      purgeProdWatchSignalsOlderThan: vi.fn(async () => undefined),
      listEnabledProdWatchSubscriptions: vi.fn(async () => [sub]),
      getTargetById: vi.fn(async () => target),
      updateProdWatchSubscriptionStatus: vi.fn(async () => undefined),
      insertProdWatchSignal: vi.fn(async () => undefined),
      getOpenProdWatchIncident: vi.fn(async () => null),
      closeProdWatchIncident: vi.fn(async () => undefined),
      upsertOpenProdWatchIncident: vi.fn(),
      touchProdWatchIncident: vi.fn(),
      getTargetAlertPrefs: vi.fn(async () => []),
    } as unknown as DbAdapter;

    const fetchImpl = vi.fn(async () => {
      throw new Error('ECONNREFUSED');
    }) as unknown as typeof fetch;

    try {
      const result = await runProdWatchBatch({ db, fetchImpl });
      expect(result.errors).toBe(0);
      expect(result.checked).toBe(1);
      expect(result.results[0]?.status).toBe('not_checked');
      expect(result.results[0]?.error).toBe('unreachable');
      expect(db.insertProdWatchSignal).not.toHaveBeenCalled();
    } finally {
      if (previous === undefined) delete process.env.ASSURLY_PROD_WATCH_ENABLED;
      else process.env.ASSURLY_PROD_WATCH_ENABLED = previous;
    }
  });

  it('does no work when the feature flag is off', async () => {
    const previous = process.env.ASSURLY_PROD_WATCH_ENABLED;
    delete process.env.ASSURLY_PROD_WATCH_ENABLED;

    const db = {
      listEnabledProdWatchSubscriptions: vi.fn(async () => [subscription()]),
      purgeProdWatchSignalsOlderThan: vi.fn(async () => undefined),
    } as unknown as DbAdapter;

    try {
      const result = await runProdWatchBatch({ db });
      expect(result.checked).toBe(0);
      expect(db.listEnabledProdWatchSubscriptions).not.toHaveBeenCalled();
    } finally {
      if (previous === undefined) delete process.env.ASSURLY_PROD_WATCH_ENABLED;
      else process.env.ASSURLY_PROD_WATCH_ENABLED = previous;
    }
  });
});
