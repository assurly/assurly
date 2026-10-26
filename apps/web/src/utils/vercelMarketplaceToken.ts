import crypto from 'node:crypto';
import { z } from 'zod';

/**
 * Verifies the OIDC token Vercel puts on every Marketplace Partner API call.
 *
 * Confirmed against Vercel's docs and `marketplace.vercel.com/.well-known/openid-configuration`:
 * - issuer `https://marketplace.vercel.com`, RS256 only, keys at `/.well-known/jwks`
 * - `aud` is our integration id (`oac_…`), `installation_id` names the installation
 * - user tokens carry `user_id` and `user_role` (ADMIN | USER); system tokens do not
 *
 * Node's crypto verifies the signature, so no JWT library is needed.
 */

export const MARKETPLACE_ISSUER = 'https://marketplace.vercel.com';
const JWKS_URL = `${MARKETPLACE_ISSUER}/.well-known/jwks`;
const JWKS_TTL_MS = 60 * 60 * 1000;
/** An unknown `kid` refetches the key set, but never more than once a minute. */
const JWKS_REFRESH_FLOOR_MS = 60 * 1000;
const CLOCK_SKEW_S = 60;
const INSTALLATION_ID = /^icfg_[A-Za-z0-9]{1,64}$/;

export class MarketplaceAuthError extends Error {
  constructor(readonly reason: string) {
    super(`Marketplace token rejected: ${reason}.`);
    this.name = 'MarketplaceAuthError';
  }
}

const claimsSchema = z.object({
  iss: z.literal(MARKETPLACE_ISSUER),
  aud: z.string().min(1),
  exp: z.number(),
  iat: z.number().optional(),
  nbf: z.number().optional(),
  sub: z.string().min(1).nullable().optional(),
  account_id: z.string().min(1).max(128),
  installation_id: z.string().regex(INSTALLATION_ID).nullable(),
  user_id: z.string().min(1).max(128).optional(),
  user_role: z.enum(['ADMIN', 'USER']).optional(),
  user_email: z.string().max(320).optional(),
  user_email_verified: z.boolean().optional(),
  user_name: z.string().max(200).optional(),
  // The SSO exchange's id_token may carry the standard OIDC names instead.
  email: z.string().max(320).optional(),
  email_verified: z.boolean().optional(),
  name: z.string().max(200).optional(),
});

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** An address Vercel says it verified, lower-cased; anything else is null. */
function verifiedEmailOf(claims: z.infer<typeof claimsSchema>): string | null {
  const candidates: [string | undefined, boolean | undefined][] = [
    [claims.user_email, claims.user_email_verified],
    [claims.email, claims.email_verified ?? claims.user_email_verified],
  ];
  for (const [email, verified] of candidates) {
    const value = email?.trim().toLowerCase();
    if (value && verified === true && EMAIL.test(value)) return value;
  }
  return null;
}

export interface MarketplaceCaller {
  kind: 'user' | 'system';
  installationId: string | null;
  accountId: string;
  userId: string | null;
  userRole: 'ADMIN' | 'USER' | null;
  /** Only when Vercel says it is verified. */
  verifiedEmail: string | null;
  userName: string | null;
}

interface Jwk {
  kid?: string;
  kty?: string;
  alg?: string;
  use?: string;
  n?: string;
  e?: string;
}

export type JwksSource = () => Promise<Jwk[]>;

let cached: { keys: Jwk[]; fetchedAt: number } | null = null;

async function fetchJwks(): Promise<Jwk[]> {
  const response = await fetch(JWKS_URL, { signal: AbortSignal.timeout(5_000) }).catch(() => {
    throw new MarketplaceAuthError('jwks unavailable');
  });
  if (!response.ok) throw new MarketplaceAuthError('jwks unavailable');
  const body = (await response.json()) as { keys?: unknown };
  if (!Array.isArray(body.keys)) throw new MarketplaceAuthError('jwks malformed');
  return body.keys as Jwk[];
}

/** The live key set, cached for an hour and refreshed early on an unknown `kid`. */
async function keyFor(kid: string, source: JwksSource, now: number): Promise<Jwk | null> {
  const fresh = cached && now - cached.fetchedAt < JWKS_TTL_MS;
  const hit = fresh ? cached?.keys.find((key) => key.kid === kid) : undefined;
  if (hit) return hit;
  if (cached && fresh && now - cached.fetchedAt < JWKS_REFRESH_FLOOR_MS) return null;
  cached = { keys: await source(), fetchedAt: now };
  return cached.keys.find((key) => key.kid === kid) ?? null;
}

/** Test hook: forget the cached key set. */
export function resetMarketplaceJwksCache(): void {
  cached = null;
}

function decodeSegment(segment: string): unknown {
  return JSON.parse(Buffer.from(segment, 'base64url').toString('utf8'));
}

export interface VerifyOptions {
  clientId: string;
  now?: number;
  jwks?: JwksSource;
}

export async function verifyMarketplaceToken(
  token: string,
  options: VerifyOptions,
): Promise<MarketplaceCaller> {
  const parts = token.split('.');
  if (parts.length !== 3 || parts.some((part) => !part)) {
    throw new MarketplaceAuthError('malformed');
  }
  const [headerPart, payloadPart, signaturePart] = parts as [string, string, string];

  let header: { alg?: unknown; kid?: unknown };
  let payload: unknown;
  try {
    header = decodeSegment(headerPart) as { alg?: unknown; kid?: unknown };
    payload = decodeSegment(payloadPart);
  } catch {
    throw new MarketplaceAuthError('malformed');
  }
  // Pinned: an attacker must not pick `none` or an HMAC alg keyed by the public key.
  if (header.alg !== 'RS256' || typeof header.kid !== 'string') {
    throw new MarketplaceAuthError('unsupported algorithm');
  }

  const now = options.now ?? Date.now();
  const jwk = await keyFor(header.kid, options.jwks ?? fetchJwks, now);
  if (!jwk || jwk.kty !== 'RSA' || (jwk.alg && jwk.alg !== 'RS256')) {
    throw new MarketplaceAuthError('unknown key');
  }
  const key = crypto.createPublicKey({ key: { kty: 'RSA', n: jwk.n, e: jwk.e }, format: 'jwk' });
  const valid = crypto.verify(
    'RSA-SHA256',
    Buffer.from(`${headerPart}.${payloadPart}`),
    key,
    Buffer.from(signaturePart, 'base64url'),
  );
  if (!valid) throw new MarketplaceAuthError('bad signature');

  const parsed = claimsSchema.safeParse(payload);
  if (!parsed.success) throw new MarketplaceAuthError('claims');
  const claims = parsed.data;
  const nowS = Math.floor(now / 1000);
  if (claims.aud !== options.clientId) throw new MarketplaceAuthError('audience');
  if (claims.exp + CLOCK_SKEW_S < nowS) throw new MarketplaceAuthError('expired');
  if (claims.nbf !== undefined && claims.nbf - CLOCK_SKEW_S > nowS) {
    throw new MarketplaceAuthError('not yet valid');
  }

  const isUser = claims.user_id !== undefined;
  if (isUser && !claims.user_role) throw new MarketplaceAuthError('claims');
  return {
    kind: isUser ? 'user' : 'system',
    installationId: claims.installation_id,
    accountId: claims.account_id,
    userId: claims.user_id ?? null,
    userRole: claims.user_role ?? null,
    verifiedEmail: verifiedEmailOf(claims),
    userName: claims.user_name ?? claims.name ?? null,
  };
}

/** `Authorization: Bearer <jwt>`, or null. */
export function bearerToken(request: Request): string | null {
  const match = request.headers.get('authorization')?.match(/^Bearer\s+([A-Za-z0-9._-]+)$/i);
  return match?.[1] ?? null;
}
