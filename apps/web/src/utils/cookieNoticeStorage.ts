import { COOKIE_POLICY_VERSION } from './cookieInventory';

export const COOKIE_NOTICE_STORAGE_KEY = 'assurly-cookie-notice-dismissed';

export interface CookieNoticeDismissState {
  version: string;
  dismissedAt: string;
}

/**
 * Fallback for browsers where `localStorage` is unavailable — Safari private
 * mode, and any browser where the user has blocked site data. Writing there
 * throws, and without this the dismiss button would fail silently and the notice
 * could never be closed.
 *
 * The notice then stays dismissed for this page session only and returns on the
 * next load, which is the honest outcome: we cannot remember a preference we are
 * not permitted to store.
 */
let dismissedThisSession = false;

export function readCookieNoticeDismissed(): boolean {
  if (typeof window === 'undefined') return false;
  if (dismissedThisSession) return true;

  try {
    const raw = window.localStorage.getItem(COOKIE_NOTICE_STORAGE_KEY);
    if (!raw) return false;
    const parsed = JSON.parse(raw) as Partial<CookieNoticeDismissState>;
    return parsed.version === COOKIE_POLICY_VERSION;
  } catch {
    return false;
  }
}

export function persistCookieNoticeDismissed(): void {
  dismissedThisSession = true;

  const state: CookieNoticeDismissState = {
    version: COOKIE_POLICY_VERSION,
    dismissedAt: new Date().toISOString(),
  };

  try {
    window.localStorage.setItem(COOKIE_NOTICE_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Storage blocked or full. The in-memory flag above already closed the
    // notice; there is nothing further to do and nothing worth reporting.
  }
}

/** Test seam: resets the in-memory fallback between cases. */
export function resetCookieNoticeSessionState(): void {
  dismissedThisSession = false;
}
