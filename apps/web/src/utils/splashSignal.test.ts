// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest';
import { consumeDashboardSplashRequest, requestDashboardSplash } from './splashSignal';

afterEach(() => {
  window.sessionStorage.clear();
});

describe('splashSignal', () => {
  it('reports no request when nothing was signalled', () => {
    expect(consumeDashboardSplashRequest()).toBe(false);
  });

  it('signals a splash that is consumed exactly once (no refresh replay)', () => {
    requestDashboardSplash();

    expect(consumeDashboardSplashRequest()).toBe(true);
    // A second read (e.g. a refresh or re-mount) must not replay the splash.
    expect(consumeDashboardSplashRequest()).toBe(false);
  });
});
