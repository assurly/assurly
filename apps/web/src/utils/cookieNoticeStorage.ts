import { COOKIE_POLICY_VERSION } from './cookieInventory';

export const COOKIE_NOTICE_STORAGE_KEY = 'assurly-cookie-notice-dismissed';

export interface CookieNoticeDismissState {
  version: string;
  dismissedAt: string;
}

export function readCookieNoticeDismissed(): boolean {
  if (typeof window === 'undefined') return false;

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
  const state: CookieNoticeDismissState = {
    version: COOKIE_POLICY_VERSION,
    dismissedAt: new Date().toISOString(),
  };
  window.localStorage.setItem(COOKIE_NOTICE_STORAGE_KEY, JSON.stringify(state));
}
