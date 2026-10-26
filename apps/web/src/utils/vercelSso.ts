import { createClient } from '@supabase/supabase-js';
import { CONTACT_SUBJECT_PARAM } from './contactSubjects';
import type { DbAdapter, Membership } from './dbAdapter';
import { getSupabaseAdminConfig } from './env';
import type { SupabaseSessionPayload } from './sessionCookie';
import { createStatelessSupabaseClient } from './supabase';
import {
  VercelApiError,
  vercelErrorDetail,
  type VercelIntegrationConfig,
} from './vercelIntegration';
import { verifyMarketplaceToken, type MarketplaceCaller } from './vercelMarketplaceToken';

/**
 * "Open in Assurly" from the Vercel dashboard (Marketplace SSO).
 *
 * Confirmed against Vercel's Marketplace API docs, its OIDC discovery document
 * and the example integration:
 * - Vercel sends the person to our redirectLoginUrl with `code` and `state`
 *   (plus context such as `resource_id`, `path`, `support`, `url`).
 * - `POST https://api.vercel.com/v1/integrations/sso/token` with
 *   `{ code, state, client_id, client_secret }` returns an `id_token` signed
 *   with the Marketplace keys. It is verified like any Partner API token and
 *   never stored.
 *
 * The person becomes a member of the workspace that belongs to the team's
 * installation (Vercel ADMIN → admin, otherwise member). Their Assurly account
 * is the one for their Vercel-verified email, so someone who already signed in
 * with GitHub under that address lands in the same account.
 */

const SSO_TOKEN_URL = 'https://api.vercel.com/v1/integrations/sso/token';
const REQUEST_TIMEOUT_MS = 10_000;

export type SsoFailure =
  | 'not_configured'
  | 'exchange_failed'
  | 'invalid_token'
  | 'unknown_installation'
  | 'email_unverified'
  | 'session_failed';

export class SsoError extends Error {
  constructor(readonly reason: SsoFailure) {
    super(`Vercel SSO failed: ${reason}.`);
    this.name = 'SsoError';
  }
}

/** Trades the one-time SSO code for Vercel's id_token. */
export async function exchangeSsoCode(
  code: string,
  state: string | null,
  config: VercelIntegrationConfig,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const response = await fetchImpl(SSO_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      code,
      ...(state ? { state } : {}),
      client_id: config.clientId,
      client_secret: config.clientSecret,
    }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  }).catch(() => null);
  if (!response) throw new SsoError('exchange_failed');
  if (!response.ok) {
    throw new VercelApiError(response.status, 'sso exchange', await vercelErrorDetail(response));
  }
  const body = (await response.json().catch(() => null)) as { id_token?: unknown } | null;
  if (typeof body?.id_token !== 'string' || !body.id_token) throw new SsoError('exchange_failed');
  return body.id_token;
}

export interface IssuedSession {
  userId: string;
  session: SupabaseSessionPayload;
}

/** Signs a person into Supabase by an email Vercel verified. */
export type SessionIssuer = (email: string, name: string | null) => Promise<IssuedSession>;

/**
 * Supabase has no "sign in as" call, so the session comes from a magic link the
 * server generates and redeems itself: nothing is emailed, and the link never
 * leaves this function. The account is created on first sight with the email
 * already confirmed, since Vercel verified it.
 */
export function createSupabaseSessionIssuer(): SessionIssuer {
  return async (email, name) => {
    const { url, serviceRoleKey } = getSupabaseAdminConfig();
    const admin = createClient(url, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const created = await admin.auth.admin.createUser({
      email,
      email_confirm: true,
      user_metadata: name ? { full_name: name } : {},
    });
    if (created.error && created.error.code !== 'email_exists' && created.error.status !== 422) {
      throw new SsoError('session_failed');
    }

    const link = await admin.auth.admin.generateLink({ type: 'magiclink', email });
    const tokenHash = link.data.properties?.hashed_token;
    if (link.error || !tokenHash) throw new SsoError('session_failed');

    const { data, error } = await createStatelessSupabaseClient().auth.verifyOtp({
      type: 'magiclink',
      token_hash: tokenHash,
    });
    if (error || !data.session || !data.user) throw new SsoError('session_failed');
    return {
      userId: data.user.id,
      session: {
        accessToken: data.session.access_token,
        refreshToken: data.session.refresh_token,
        expiresAt: Math.floor(Date.now() / 1000) + (data.session.expires_in || 3600),
      },
    };
  };
}

export interface SsoQuery {
  code?: string;
  state?: string;
  resource_id?: string;
  path?: string;
  support?: string;
  url?: string;
}

/**
 * Where to send the person after sign-in. Vercel's `url` is honoured only when
 * it points into Assurly itself, so the SSO link can never become an open
 * redirect. Support requests open the contact form; everything else (a
 * resource, billing, usage, onboarding) opens the dashboard, where Live Lock
 * shows its projects and runs.
 */
export function ssoDestination(query: SsoQuery, appUrl: string): string {
  const app = new URL(appUrl);
  if (query.support === 'true' || query.path === 'support') {
    return `${app.origin}/?${CONTACT_SUBJECT_PARAM}=technical#contact`;
  }
  if (query.url) {
    try {
      const target = new URL(query.url.replace(/^sso:/, ''), app.origin);
      if (target.origin === app.origin && !target.pathname.startsWith('//')) {
        return `${app.origin}${target.pathname}${target.search}${target.hash}`;
      }
    } catch {
      // A malformed URL falls through to the dashboard.
    }
  }
  return `${app.origin}/dashboard`;
}

export interface SsoDeps {
  config: VercelIntegrationConfig | null;
  db: DbAdapter;
  exchange: (code: string, state: string | null) => Promise<string>;
  verify: (idToken: string) => Promise<MarketplaceCaller>;
  issueSession: SessionIssuer;
}

export function roleFor(caller: MarketplaceCaller): Membership['role'] {
  return caller.userRole === 'ADMIN' ? 'admin' : 'member';
}

/** The whole sign-in. Throws `SsoError` with a reason the error page can explain. */
export async function completeVercelSso(
  query: SsoQuery,
  deps: SsoDeps,
): Promise<IssuedSession & { organizationId: string }> {
  if (!deps.config) throw new SsoError('not_configured');
  if (!query.code) throw new SsoError('exchange_failed');
  const code = query.code;

  let idToken: string;
  try {
    idToken = await deps.exchange(code, query.state ?? null);
  } catch (error) {
    if (error instanceof SsoError) throw error;
    throw new SsoError('exchange_failed');
  }

  let caller: MarketplaceCaller;
  try {
    caller = await deps.verify(idToken);
  } catch {
    throw new SsoError('invalid_token');
  }
  if (caller.kind !== 'user' || !caller.userId || !caller.installationId) {
    throw new SsoError('invalid_token');
  }
  if (!(await deps.db.getVercelInstallation(caller.installationId))) {
    throw new SsoError('unknown_installation');
  }
  if (!caller.verifiedEmail) throw new SsoError('email_unverified');

  let issued: IssuedSession;
  try {
    issued = await deps.issueSession(caller.verifiedEmail, caller.userName);
  } catch {
    throw new SsoError('session_failed');
  }
  const organizationId = await deps.db.joinVercelInstallation(
    caller.installationId,
    issued.userId,
    roleFor(caller),
  );
  // The installation was removed between the check above and now.
  if (!organizationId) throw new SsoError('unknown_installation');
  return { ...issued, organizationId };
}

export function verifySsoToken(config: VercelIntegrationConfig) {
  return (idToken: string) => verifyMarketplaceToken(idToken, { clientId: config.clientId });
}
