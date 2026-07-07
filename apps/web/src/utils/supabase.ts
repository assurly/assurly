import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { getSupabaseConfig } from './env';

let supabaseInstance: SupabaseClient | null = null;

/** Marks a cookie as part of the transient PKCE handshake (code verifier). */
function isPkceCookie(name: string): boolean {
  return name.includes('code-verifier');
}

/**
 * Returns a cached SupabaseClient instance if the environment variables are configured.
 * Otherwise, returns null, signaling simulated auth/db mode.
 */
export function getSupabaseClient(): SupabaseClient {
  const { url, anonKey } = getSupabaseConfig();

  if (!supabaseInstance) {
    supabaseInstance = createClient(url, anonKey, {
      auth: {
        persistSession: false, // Server-side environment, session managed via cookies
      },
    });
  }

  return supabaseInstance;
}

/**
 * Returns a fresh, fully stateless Supabase client. Unlike the cached client
 * above, this instance never persists or auto-refreshes a session, so callers
 * can safely bind a specific session to it (e.g. to revoke it on logout)
 * without mutating shared global auth state across concurrent requests.
 */
export function createStatelessSupabaseClient(): SupabaseClient {
  const { url, anonKey } = getSupabaseConfig();
  return createClient(url, anonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

/**
 * Returns a new server-side Supabase client using @supabase/ssr, used purely as
 * a stateless PKCE/OAuth helper for the login and callback routes.
 *
 * SINGLE SOURCE OF TRUTH: the canonical session lives exclusively in the
 * `assurly-session` cookie (see utils/auth). We therefore persist ONLY the
 * transient PKCE code-verifier cookie and deliberately drop the Supabase
 * `sb-*-auth-token` session cookies this client would otherwise write.
 *
 * Storing the session in two places previously let the proxy and the SSR client
 * rotate the same refresh token independently, tripping Supabase's refresh-token
 * reuse detection ("refresh_token_already_used") and silently revoking the
 * user's session shortly after a successful login.
 */
export async function getServerSupabaseClient() {
  const { url, anonKey } = getSupabaseConfig();

  const cookieStore = await cookies();

  return createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            if (isPkceCookie(name)) cookieStore.set(name, value, options);
          }
        } catch {
          // setAll can be invoked during a Server Component render where mutating
          // cookies is disallowed. The auth routes that rely on PKCE run inside
          // Route Handlers, where writing the verifier cookie succeeds.
        }
      },
    },
  });
}
