import crypto from 'node:crypto';

/**
 * Timing-safe verification of an `Authorization: Bearer <secret>` header against
 * a shared secret. Fail-closed: an unset/empty secret OR a missing/mismatched
 * header returns false, so a caller must reject and do no work.
 *
 * Mirrors the cron-auth shape (utils/cronAuth.ts) but is generic so any
 * secret-gated internal route (e.g. the Phase 8 exit-metrics surface) can reuse
 * it without inventing its own comparison.
 */
export function verifyBearerSecret(
  authorizationHeader: string | null,
  secret: string | undefined,
): boolean {
  const trimmedSecret = secret?.trim();
  if (!trimmedSecret) return false;
  if (!authorizationHeader) return false;

  const expected = Buffer.from(`Bearer ${trimmedSecret}`);
  const provided = Buffer.from(authorizationHeader.trim());
  if (expected.length !== provided.length) return false;
  return crypto.timingSafeEqual(expected, provided);
}
