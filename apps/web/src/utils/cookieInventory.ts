import { COOKIE_NAME } from './sessionCookie';

export const COOKIE_POLICY_VERSION = '2026-06-27';

export type CookieCategory = 'strictly-necessary';

export interface CookieInventoryEntry {
  name: string;
  category: CookieCategory;
  purpose: string;
  duration: string;
  party: 'First-party (Assurly)' | 'Third-party (GitHub, during sign-in redirect only)';
  storage: 'HTTP cookie' | 'Browser local storage';
  technicalDetails: string;
  setWhen: string;
}

export const COOKIE_INVENTORY: CookieInventoryEntry[] = [
  {
    name: COOKIE_NAME,
    category: 'strictly-necessary',
    purpose:
      'Keeps you signed in to the dashboard, stores your Supabase session tokens, and (when granted) your GitHub OAuth token so connected repository scans and auto-fix PRs can run.',
    duration:
      'Until session expiry or logout. Max-Age is aligned with your Supabase session (typically up to the refresh-token lifetime configured in Supabase Auth).',
    party: 'First-party (Assurly)',
    storage: 'HTTP cookie',
    technicalDetails: 'HttpOnly; Path=/; SameSite=Lax; Secure in production.',
    setWhen: 'After successful GitHub sign-in via /api/auth/callback.',
  },
  {
    name: 'sb-*-auth-token-code-verifier',
    category: 'strictly-necessary',
    purpose:
      'Temporary PKCE secret used only during the GitHub OAuth handshake to prevent authorization-code interception.',
    duration: 'Minutes — removed automatically after sign-in completes or fails.',
    party: 'First-party (Assurly)',
    storage: 'HTTP cookie',
    technicalDetails:
      'HttpOnly; written only by the Supabase SSR OAuth helper during login. Supabase session auth-token cookies are intentionally not persisted by Assurly.',
    setWhen: 'When you start “Sign in with GitHub”.',
  },
  {
    name: 'sb-*-auth-token (legacy cleanup)',
    category: 'strictly-necessary',
    purpose:
      'Legacy Supabase session cookies from older builds. Assurly clears these on login/logout so only assurly-session remains the session store.',
    duration: 'Expired immediately on next login or logout (Max-Age=0).',
    party: 'First-party (Assurly)',
    storage: 'HTTP cookie',
    technicalDetails: 'Not set by current builds; cleared if still present in your browser.',
    setWhen: 'Cleanup during auth callback or logout.',
  },
];

export const COOKIE_NOTICE_COPY = {
  title: 'Essential cookies only',
  body: 'Assurly uses strictly necessary cookies to keep you signed in and complete GitHub OAuth securely. We do not use advertising, analytics, or marketing cookies, so we show this notice for transparency — not to ask for optional consent.',
  detailsLabel: 'Cookie details',
  dismissLabel: 'Got it',
} as const;

export const NON_COOKIE_STORAGE: CookieInventoryEntry[] = [
  {
    name: 'assurly-cookie-notice-dismissed',
    category: 'strictly-necessary',
    purpose: 'Remembers that you closed the informational cookie notice on this device.',
    duration: 'Until you clear site data or we publish a new cookie policy version.',
    party: 'First-party (Assurly)',
    storage: 'Browser local storage',
    technicalDetails: 'No tracking; UI preference only.',
    setWhen: 'When you dismiss the cookie notice.',
  },
];

export function getCookieCategoryLabel(category: CookieCategory): string {
  switch (category) {
    case 'strictly-necessary':
      return 'Strictly necessary';
    default: {
      const neverCategory: never = category;
      return neverCategory;
    }
  }
}
