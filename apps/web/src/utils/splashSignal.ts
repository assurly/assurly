/**
 * Cross-route signal that asks the dashboard to play its post-login splash.
 *
 * The splash must appear every time the user enters the dashboard *from the
 * landing page* — first login and every subsequent return, even a quick
 * landing → dashboard bounce. Client-side navigation keeps the tab alive, so a
 * per-tab `sessionStorage` flag is the most reliable, refresh-safe carrier:
 * the landing sets it right before navigating, and the dashboard consumes
 * (clears) it on mount. A plain reload of the dashboard sets no flag, so the
 * splash never replays outside a landing entry.
 */
const DASHBOARD_SPLASH_FLAG = 'assurly:dashboard-splash';

/** Called on the landing page immediately before navigating into the dashboard. */
export function requestDashboardSplash(): void {
  try {
    window.sessionStorage.setItem(DASHBOARD_SPLASH_FLAG, '1');
  } catch {
    // Storage can be unavailable (private mode / blocked cookies). The splash is
    // a non-essential flourish, so silently skip it rather than break navigation.
  }
}

/**
 * Reads and clears any pending splash request. Returns `true` exactly once per
 * request so the caller can render the splash a single time.
 */
export function consumeDashboardSplashRequest(): boolean {
  try {
    if (window.sessionStorage.getItem(DASHBOARD_SPLASH_FLAG) === '1') {
      window.sessionStorage.removeItem(DASHBOARD_SPLASH_FLAG);
      return true;
    }
  } catch {
    // Ignore — treat an unreadable store as "no request".
  }
  return false;
}
