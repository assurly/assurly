import type { User as SupabaseUser } from '@supabase/supabase-js';
import type { DbAdapter, User } from './dbAdapter';
import { getUserDbAdapter } from './dbAdapter';
import { createStatelessSupabaseClient, getSupabaseClient } from './supabase';
import {
  COOKIE_NAME,
  serializeSessionCookiePayload,
  type SupabaseSessionPayload,
} from './sessionCookie';

export { COOKIE_NAME, type SupabaseSessionPayload };

export interface AuthContext {
  user: User;
  accessToken: string;
  githubAccessToken?: string;
  db: DbAdapter;
}

export class AuthenticationError extends Error {
  readonly status = 401;

  constructor(message = 'Unauthorized') {
    super(message);
    this.name = 'AuthenticationError';
  }
}

function toUser(user: SupabaseUser): User {
  return {
    id: user.id,
    name: user.user_metadata?.full_name || user.user_metadata?.name || 'GitHub User',
    email: user.email || '',
    avatar_url: user.user_metadata?.avatar_url || '',
  };
}

function readSessionPayload(req: Request): Partial<SupabaseSessionPayload> | null {
  const authHeader = req.headers.get('authorization');
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.slice('Bearer '.length).trim();
    return token ? { accessToken: token } : null;
  }

  const sessionToken = parseCookies(req.headers.get('cookie') || '')[COOKIE_NAME];
  if (!sessionToken) return null;

  try {
    return JSON.parse(decodeURIComponent(sessionToken)) as Partial<SupabaseSessionPayload>;
  } catch {
    return null;
  }
}

function readAccessToken(req: Request): string | null {
  const payload = readSessionPayload(req);
  return typeof payload?.accessToken === 'string' && payload.accessToken
    ? payload.accessToken
    : null;
}

function readGitHubAccessToken(req: Request): string | undefined {
  const payload = readSessionPayload(req);
  const token = payload?.githubAccessToken;
  return typeof token === 'string' && token ? token : undefined;
}

/** Loads the GitHub OAuth token from the session cookie or Supabase session store. */
export async function resolveGitHubAccessToken(req: Request): Promise<string | undefined> {
  const fromCookie = readGitHubAccessToken(req);
  if (fromCookie) return fromCookie;

  const payload = readSessionPayload(req);
  if (
    typeof payload?.accessToken !== 'string' ||
    !payload.accessToken ||
    typeof payload.refreshToken !== 'string' ||
    !payload.refreshToken
  ) {
    return undefined;
  }

  try {
    const supabase = createStatelessSupabaseClient();
    const { data, error } = await supabase.auth.setSession({
      access_token: payload.accessToken,
      refresh_token: payload.refreshToken,
    });
    if (error) return undefined;
    const providerToken = data.session?.provider_token;
    return typeof providerToken === 'string' && providerToken ? providerToken : undefined;
  } catch {
    return undefined;
  }
}

export async function requireUser(req: Request): Promise<AuthContext> {
  const accessToken = readAccessToken(req);
  if (!accessToken) throw new AuthenticationError();

  try {
    const { data, error } = await getSupabaseClient().auth.getUser(accessToken);
    if (error || !data.user) throw new AuthenticationError();

    return {
      user: toUser(data.user),
      accessToken,
      githubAccessToken: readGitHubAccessToken(req),
      db: getUserDbAdapter(accessToken),
    };
  } catch (error) {
    if (error instanceof AuthenticationError) throw error;
    throw new AuthenticationError();
  }
}

/**
 * Parses the full canonical session payload from the `assurly-session` cookie.
 * Returns null unless every field required to act on the session (access token,
 * refresh token and expiry) is present and well-formed. Used by logout to revoke
 * the underlying Supabase session, which is stored only in this cookie.
 */
export function parseSessionCookie(req: Request): SupabaseSessionPayload | null {
  const raw = parseCookies(req.headers.get('cookie') || '')[COOKIE_NAME];
  if (!raw) return null;

  try {
    const payload = JSON.parse(decodeURIComponent(raw)) as Partial<SupabaseSessionPayload>;
    if (
      typeof payload.accessToken === 'string' &&
      payload.accessToken &&
      typeof payload.refreshToken === 'string' &&
      payload.refreshToken &&
      typeof payload.expiresAt === 'number'
    ) {
      return {
        accessToken: payload.accessToken,
        refreshToken: payload.refreshToken,
        expiresAt: payload.expiresAt,
        githubAccessToken:
          typeof payload.githubAccessToken === 'string' && payload.githubAccessToken
            ? payload.githubAccessToken
            : undefined,
      };
    }
    return null;
  } catch {
    return null;
  }
}

export async function getSessionUser(req: Request): Promise<User | null> {
  try {
    return (await requireUser(req)).user;
  } catch (error) {
    if (error instanceof AuthenticationError) return null;
    throw error;
  }
}

export function setSupabaseSessionCookie(session: SupabaseSessionPayload): string {
  const encoded = serializeSessionCookiePayload(session);
  const secure = process.env.NODE_ENV === 'production' ? ' Secure;' : '';
  const maxAge = Math.max(0, session.expiresAt - Math.floor(Date.now() / 1000));

  return `${COOKIE_NAME}=${encoded}; HttpOnly; Path=/; SameSite=Lax;${secure} Max-Age=${maxAge}`;
}

export function clearSessionCookie(): string {
  const secure = process.env.NODE_ENV === 'production' ? ' Secure;' : '';
  return `${COOKIE_NAME}=; HttpOnly; Path=/; SameSite=Lax;${secure} Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT`;
}

/**
 * Matches the Supabase SSR auth-token cookies (including chunked variants like
 * `sb-<ref>-auth-token.0`) that older builds persisted alongside our canonical
 * session. The transient `-code-verifier` cookie is intentionally excluded.
 */
const LEGACY_SUPABASE_AUTH_COOKIE = /^sb-.+-auth-token(\.\d+)?$/;

/**
 * Produces Set-Cookie headers that expire any legacy Supabase `sb-*-auth-token`
 * cookies still present on the request. The session is now stored solely in
 * `assurly-session`; these duplicates are inert but are cleared on the next
 * login/logout so a stale second session store cannot linger in the browser.
 */
export function clearLegacySupabaseAuthCookies(req: Request): string[] {
  const secure = process.env.NODE_ENV === 'production' ? ' Secure;' : '';
  return Object.keys(parseCookies(req.headers.get('cookie') || ''))
    .filter((name) => LEGACY_SUPABASE_AUTH_COOKIE.test(name))
    .map(
      (name) =>
        `${name}=; HttpOnly; Path=/; SameSite=Lax;${secure} Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT`,
    );
}

function parseCookies(cookieHeader: string): Record<string, string> {
  return cookieHeader.split(';').reduce<Record<string, string>>((cookies, item) => {
    const separator = item.indexOf('=');
    if (separator < 0) return cookies;
    const name = item.slice(0, separator).trim();
    if (name) cookies[name] = item.slice(separator + 1).trim();
    return cookies;
  }, {});
}
