import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { serializeSessionCookiePayload } from './utils/sessionCookie';

const COOKIE_NAME = 'shipready-session';

/**
 * Route prefixes that require an authenticated session. Anonymous requests to
 * these paths are redirected at the network boundary, before the page is ever
 * server-rendered. This avoids paying the SSR cost for visitors who could not
 * see the data anyway and removes the reliance on a client-side-only guard.
 */
const PROTECTED_ROUTE_PREFIXES = ['/dashboard'] as const;

/** Public destination anonymous users are sent to when hitting a protected route. */
const ANONYMOUS_REDIRECT_PATH = '/';

function shouldBypassProtectedRouteForPerfBaseline(request: NextRequest): boolean {
  if (process.env.PERF_BASELINE !== '1') return false;
  const host = request.headers.get('host') ?? request.nextUrl.host;
  return host.startsWith('127.0.0.1') || host.startsWith('localhost');
}

/**
 * Refresh the session once it is within this many seconds of expiring. Kept
 * deliberately small: a large eager window means every request for minutes
 * before expiry attempts a rotation, multiplying the chance of a concurrent
 * refresh race against Supabase's refresh-token reuse detection.
 */
const REFRESH_THRESHOLD_SECONDS = 60;

interface OptimisticSession {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
  githubAccessToken?: string;
}

interface RefreshedSession {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

interface RefreshOutcome {
  /** The rotated session, or null when the refresh did not yield one. */
  session: RefreshedSession | null;
  /**
   * True when the failure was Supabase reporting the refresh token as already
   * used — i.e. a concurrent request already rotated it. This is recoverable
   * (a sibling request holds the fresh token) and must NOT be treated as a hard
   * auth failure, otherwise we would clear a session that is actually alive.
   */
  reused: boolean;
}

/**
 * Coalesces concurrent refreshes within the same runtime isolate. A single page
 * navigation fans out into many parallel requests (RSC payloads, prefetches,
 * data requests) that all traverse this proxy. Without coalescing, each would
 * call the token endpoint with the same refresh token: the first rotates it and
 * the rest fail with `refresh_token_already_used`, which Supabase interprets as
 * token theft and responds to by revoking the entire session family.
 */
const inFlightRefreshes = new Map<string, Promise<RefreshOutcome>>();

function isRefreshReuseError(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  if (error.code === 'refresh_token_already_used') return true;
  return /already used/i.test(error.message ?? '');
}

async function refreshSessionOnce(
  supabaseUrl: string,
  supabaseAnonKey: string,
  refreshToken: string,
): Promise<RefreshOutcome> {
  const existing = inFlightRefreshes.get(refreshToken);
  if (existing) return existing;

  const task = (async (): Promise<RefreshOutcome> => {
    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await supabase.auth.refreshSession({ refresh_token: refreshToken });

    if (!error && data.session) {
      return {
        session: {
          accessToken: data.session.access_token,
          refreshToken: data.session.refresh_token,
          expiresAt: Math.floor(Date.now() / 1000) + (data.session.expires_in || 3600),
        },
        reused: false,
      };
    }
    return { session: null, reused: isRefreshReuseError(error) };
  })().finally(() => {
    inFlightRefreshes.delete(refreshToken);
  });

  inFlightRefreshes.set(refreshToken, task);
  return task;
}

function isProtectedRoute(pathname: string): boolean {
  return PROTECTED_ROUTE_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

/**
 * Cheap, dependency-free read of the session cookie used for the optimistic
 * routing decision. A non-empty access token is treated as a session signal,
 * mirroring the server-side `readAccessToken` contract in `utils/auth`. The
 * authoritative check (Supabase `getUser`) still runs in `requireUser` during
 * rendering — this only prevents the obvious anonymous case from rendering.
 */
function readOptimisticSession(cookieValue: string | undefined): OptimisticSession | null {
  if (!cookieValue) return null;

  try {
    const payload = JSON.parse(decodeURIComponent(cookieValue)) as Record<string, unknown>;
    const accessToken = payload?.accessToken;
    if (typeof accessToken !== 'string' || accessToken.length === 0) {
      return null;
    }

    return {
      accessToken,
      refreshToken: typeof payload.refreshToken === 'string' ? payload.refreshToken : undefined,
      expiresAt: typeof payload.expiresAt === 'number' ? payload.expiresAt : undefined,
      githubAccessToken:
        typeof payload.githubAccessToken === 'string' ? payload.githubAccessToken : undefined,
    };
  } catch {
    return null;
  }
}

function contentSecurityPolicy(nonce: string): string {
  const scriptSources = ["'self'", `'nonce-${nonce}'`, "'strict-dynamic'"];
  if (process.env.NODE_ENV === 'development') scriptSources.push("'unsafe-eval'");
  const directives = [
    "default-src 'self'",
    `script-src ${scriptSources.join(' ')}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: https://avatars.githubusercontent.com https://api.dicebear.com",
    "font-src 'self' data:",
    "connect-src 'self' https://api.github.com https://*.supabase.co",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ];
  if (process.env.NODE_ENV === 'production') directives.push('upgrade-insecure-requests');
  return directives.join('; ');
}

function createResponse(request: NextRequest, nonce: string): NextResponse {
  const requestHeaders = new Headers(request.headers);
  const policy = contentSecurityPolicy(nonce);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('Content-Security-Policy', policy);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set('Content-Security-Policy', policy);
  return response;
}

/**
 * Redirects to the public landing page and clears any stale or corrupt session
 * cookie so the user ends up in a clean, logged-out state instead of looping.
 */
function redirectAnonymous(request: NextRequest): NextResponse {
  const response = NextResponse.redirect(new URL(ANONYMOUS_REDIRECT_PATH, request.url));
  response.cookies.set(COOKIE_NAME, '', {
    httpOnly: true,
    path: '/',
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 0,
  });
  return response;
}

/**
 * Next.js Proxy (formerly Middleware) that runs before a request completes. It
 * is responsible for three things:
 *   1. Protecting authenticated routes by redirecting anonymous requests before
 *      they are server-rendered.
 *   2. Transparently refreshing Supabase sessions that are about to expire.
 *   3. Attaching a per-request nonce-based Content-Security-Policy.
 */
export async function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
  const protectedRoute = isProtectedRoute(request.nextUrl.pathname);

  const sessionCookie = request.cookies.get(COOKIE_NAME)?.value;
  const session = readOptimisticSession(sessionCookie);

  // Route protection: stop anonymous (or structurally invalid) requests to
  // protected routes before any server rendering happens.
  if (protectedRoute && !session && !shouldBypassProtectedRouteForPerfBaseline(request)) {
    return redirectAnonymous(request);
  }

  // Auth routes manage their own session lifecycle (login, callback, logout).
  // Running a token refresh here races with exchangeCodeForSession in the
  // callback handler and causes "refresh_token_already_used" errors that loop
  // the user back to the sign-in page instead of landing on the dashboard.
  if (request.nextUrl.pathname.startsWith('/api/auth/')) {
    return createResponse(request, nonce);
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const supabaseAnonKey =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;

  // Production startup validates this configuration in instrumentation.ts.
  // Without it we cannot refresh; the optimistic gate above already handled the
  // anonymous protected case, so simply continue with the CSP response.
  if (!supabaseUrl || !supabaseAnonKey || !session) {
    return createResponse(request, nonce);
  }

  // Renew sessions that are expired or within the refresh threshold.
  if (session.refreshToken && typeof session.expiresAt === 'number') {
    const now = Math.floor(Date.now() / 1000);

    if (now >= session.expiresAt - REFRESH_THRESHOLD_SECONDS) {
      try {
        const outcome = await refreshSessionOnce(
          supabaseUrl,
          supabaseAnonKey,
          session.refreshToken,
        );

        if (outcome.session) {
          const response = createResponse(request, nonce);
          response.cookies.set(
            COOKIE_NAME,
            serializeSessionCookiePayload({
              ...outcome.session,
              githubAccessToken: session.githubAccessToken,
            }),
            {
              httpOnly: true,
              path: '/',
              sameSite: 'lax',
              secure: process.env.NODE_ENV === 'production',
              maxAge: 60 * 60 * 24 * 7, // 1 week
            },
          );
          return response;
        }

        // A concurrent request already rotated this token. Our cookie is stale,
        // but the sibling request set the fresh one, so the session is still
        // alive — proceed without clearing it to avoid fighting the winning
        // refresh or logging the user out mid-navigation.
        if (outcome.reused) {
          return createResponse(request, nonce);
        }

        console.error('[Session Refresh Proxy] Failed to refresh token.');

        // The session is genuinely expired and could not be refreshed. On a
        // protected route, fail closed and send the user back to log in instead
        // of server-rendering a page their dead session cannot access.
        if (protectedRoute && now >= session.expiresAt) {
          return redirectAnonymous(request);
        }

        const staleSessionResponse = createResponse(request, nonce);
        staleSessionResponse.cookies.set(COOKIE_NAME, '', {
          httpOnly: true,
          path: '/',
          sameSite: 'lax',
          secure: process.env.NODE_ENV === 'production',
          maxAge: 0,
        });
        return staleSessionResponse;
      } catch (err: unknown) {
        // Fail silently to prevent app crash due to corrupted cookies, but still
        // fail closed for protected routes whose session has already expired.
        console.error(
          '[Session Refresh Proxy] Error:',
          err instanceof Error ? err.message : String(err),
        );
        if (protectedRoute && now >= session.expiresAt) {
          return redirectAnonymous(request);
        }
      }
    }
  }

  return createResponse(request, nonce);
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
