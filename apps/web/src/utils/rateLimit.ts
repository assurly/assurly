import crypto from 'node:crypto';
import { isIP } from 'node:net';
import type { AuthContext } from './auth';
import { getAdminDbAdapter } from './dbAdapter';
import { ConfigurationError } from './env';

export interface RateLimitPolicy {
  limit: number;
  windowSeconds: number;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
}

const memoryBuckets = new Map<string, { count: number; resetAt: number }>();

function getRateLimitSecret(): string {
  const secret = process.env.RATE_LIMIT_SECRET?.trim();
  if (secret) return secret;
  if (process.env.NODE_ENV !== 'production') return 'assurly-development-rate-limit-secret';
  throw new ConfigurationError('RATE_LIMIT_SECRET is required in production.');
}

function hashIdentity(value: string): string {
  return crypto.createHmac('sha256', getRateLimitSecret()).update(value).digest('hex');
}

export function getClientIp(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  if (forwarded && isIP(forwarded)) return forwarded;
  const realIp = request.headers.get('x-real-ip')?.trim();
  return realIp && isIP(realIp) ? realIp : 'unknown';
}

async function consume(
  keyHash: string,
  routeId: string,
  policy: RateLimitPolicy,
): Promise<RateLimitResult> {
  if (process.env.NODE_ENV === 'test') {
    const now = Math.floor(Date.now() / 1000);
    const bucketKey = `${routeId}:${keyHash}`;
    const current = memoryBuckets.get(bucketKey);
    const bucket =
      !current || current.resetAt <= now
        ? { count: 0, resetAt: now + policy.windowSeconds }
        : current;
    bucket.count += 1;
    memoryBuckets.set(bucketKey, bucket);
    return {
      allowed: bucket.count <= policy.limit,
      remaining: Math.max(0, policy.limit - bucket.count),
      resetAt: bucket.resetAt,
    };
  }

  return getAdminDbAdapter().consumeApiRateLimit(
    keyHash,
    routeId,
    policy.limit,
    policy.windowSeconds,
  );
}

export async function enforceIpRateLimit(
  request: Request,
  routeId: string,
  policy: RateLimitPolicy,
): Promise<RateLimitResult> {
  return consume(hashIdentity(`ip:${getClientIp(request)}`), `${routeId}:ip`, policy);
}

export async function enforceUserRateLimit(
  routeId: string,
  policy: RateLimitPolicy,
  auth: AuthContext,
): Promise<RateLimitResult> {
  return consume(hashIdentity(`user:${auth.user.id}`), `${routeId}:user`, policy);
}

/**
 * Plan-based rate limit for a programmatic API key (Phase 7). Keyed on the key
 * id (not the IP or a user), so each key gets its own quota and a shared IP does
 * not let one org exhaust another's budget.
 */
export async function enforceApiKeyRateLimit(
  routeId: string,
  policy: RateLimitPolicy,
  apiKeyId: string,
): Promise<RateLimitResult> {
  return consume(hashIdentity(`apikey:${apiKeyId}`), `${routeId}:apikey`, policy);
}

export function resetRateLimitsForTests(): void {
  if (process.env.NODE_ENV === 'test') memoryBuckets.clear();
}
