import { describe, expect, it } from 'vitest';
import { isProdWatchFeatureEnabled } from './constants';
import { wouldFetchForSubscription } from './batch';

describe('Prod Watch opt-in', () => {
  it('feature flag is off by default', () => {
    expect(isProdWatchFeatureEnabled({})).toBe(false);
    expect(isProdWatchFeatureEnabled({ ASSURLY_PROD_WATCH_ENABLED: '0' })).toBe(false);
    expect(isProdWatchFeatureEnabled({ ASSURLY_PROD_WATCH_ENABLED: '1' })).toBe(true);
  });

  it('does not fetch when subscription is missing or disabled', async () => {
    expect(await wouldFetchForSubscription(null, true)).toBe(false);
    expect(await wouldFetchForSubscription({ enabled: false }, true)).toBe(false);
    expect(await wouldFetchForSubscription({ enabled: true }, false)).toBe(false);
  });

  it('fetches only when feature flag and explicit enable are both on', async () => {
    expect(await wouldFetchForSubscription({ enabled: true }, true)).toBe(true);
  });

  /**
   * Prove-red: if wouldFetchForSubscription is weakened to `return true` (the
   * exact bug — fetching without consent), the assertions above fail.
   */
  it('documents the consent bug this test catches', async () => {
    const buggyWouldFetch = async (): Promise<boolean> => true;

    expect(await buggyWouldFetch()).toBe(true);
    // The real helper must not match that broken behaviour:
    expect(await wouldFetchForSubscription(null, false)).toBe(false);
  });
});
