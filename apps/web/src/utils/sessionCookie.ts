/** HttpOnly session cookie name — safe to import from client and server modules. */
export const COOKIE_NAME = 'assurly-session';

export interface SupabaseSessionPayload {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  /** GitHub OAuth token captured at sign-in; used for auto-fix PR creation. */
  githubAccessToken?: string;
}

/** Serializes the session payload for the HttpOnly `assurly-session` cookie. */
export function serializeSessionCookiePayload(session: SupabaseSessionPayload): string {
  return encodeURIComponent(JSON.stringify(session));
}
