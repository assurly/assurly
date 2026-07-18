import crypto from 'node:crypto';
import { getAdminDbAdapter, type ApiKeyAuthContext, type DbAdapter } from './dbAdapter';
import type { BillingPlan } from './entitlements';

/**
 * Programmatic API keys (Phase 7). A key authenticates an ORGANIZATION so an
 * agent/OEM caller can read the hosted, shape-only verdict via `GET /api/v1/verdict`
 * and the MCP `assurly_verdict` tool. Keys are READ-ONLY over existing verdicts;
 * they never trigger an active probe (the ownership gate stays authoritative).
 *
 * Security invariants (do not weaken):
 *   - The plaintext key is NEVER stored or logged — only its sha256 hash is
 *     persisted. The plaintext is returned to the creator exactly once.
 *   - The key body is 192 bits of CSPRNG entropy, so a plain sha256 (no salt) is
 *     safe: there is no feasible rainbow/precomputation attack on the hash.
 */

/** Non-secret display/label prefix. The full key is `${API_KEY_PREFIX}<body>`. */
export const API_KEY_PREFIX = 'ask_live_';

/** base64url alphabet, so the key body is URL/header-safe with no escaping. */
const KEY_BODY_PATTERN = /^[A-Za-z0-9_-]{32,}$/;
const FULL_KEY_PATTERN = /^ask_live_[A-Za-z0-9_-]{32,}$/;

/** Characters of the key body kept (with the prefix) as the non-secret display fragment. */
const DISPLAY_BODY_CHARS = 6;

export interface GeneratedApiKey {
  /** The full plaintext key — shown to the creator exactly once, never stored. */
  plaintext: string;
  /** sha256 hex of the plaintext — the only thing persisted. */
  keyHash: string;
  /** Short, non-secret fragment for the dashboard (e.g. `ask_live_ab12cd`). */
  keyPrefix: string;
}

/** sha256 hex of a full plaintext key. Deterministic, so lookups are by hash. */
export function hashApiKey(plaintext: string): string {
  return crypto.createHash('sha256').update(plaintext, 'utf8').digest('hex');
}

/**
 * Mints a new key. 24 random bytes (192 bits) as base64url keeps the key
 * header/URL-safe and infeasible to guess or precompute a hash for.
 */
export function generateApiKey(): GeneratedApiKey {
  const body = crypto.randomBytes(24).toString('base64url');
  const plaintext = `${API_KEY_PREFIX}${body}`;
  return {
    plaintext,
    keyHash: hashApiKey(plaintext),
    keyPrefix: `${API_KEY_PREFIX}${body.slice(0, DISPLAY_BODY_CHARS)}`,
  };
}

/** True only for a well-formed full key. Used to reject malformed keys before any DB hit. */
export function isValidApiKeyFormat(candidate: string): boolean {
  return FULL_KEY_PATTERN.test(candidate);
}

/**
 * Extracts a well-formed API key from `Authorization: Bearer <key>`.
 * Returns null for a missing, non-bearer, or malformed key — never throws.
 */
export function parseBearerApiKey(request: Request): string | null {
  const header = request.headers.get('authorization');
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  const candidate = match?.[1]?.trim();
  if (!candidate || !isValidApiKeyFormat(candidate)) return null;
  return candidate;
}

/** The org context resolved from a valid, non-revoked API key. */
export interface ApiKeyContext {
  id: string;
  organizationId: string;
  plan: BillingPlan;
}

/**
 * Resolves an API key from the request into an org context, or returns null when
 * the key is missing, malformed, unknown, or revoked (secureRoute maps null → 401).
 * The lookup uses the service role (no user session at key-auth time); `last_used_at`
 * is refreshed best-effort and never blocks or fails the request.
 */
export async function authenticateApiKey(
  request: Request,
  deps: { getDb?: () => DbAdapter } = {},
): Promise<ApiKeyContext | null> {
  const plaintext = parseBearerApiKey(request);
  if (!plaintext) return null;

  const db = deps.getDb?.() ?? getAdminDbAdapter();
  const row: ApiKeyAuthContext | null = await db.getApiKeyByHash(hashApiKey(plaintext));
  if (!row || row.revoked_at) return null;

  // Fire-and-forget: usage telemetry must never slow down or fail auth.
  void Promise.resolve(db.touchApiKey(row.id)).catch(() => undefined);

  return { id: row.id, organizationId: row.organization_id, plan: row.plan };
}

export { KEY_BODY_PATTERN };
