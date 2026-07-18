import crypto from 'node:crypto';

/**
 * Verifies the shared cron secret. Vercel Cron sends
 * `Authorization: Bearer <CRON_SECRET>` when the env var is configured.
 *
 * Fail-closed: a missing env secret OR a missing/invalid header rejects the
 * request. Callers must return 401 and do no work (no DB list, no probe).
 */
export function verifyCronAuthorization(authorizationHeader: string | null): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return false;
  if (!authorizationHeader) return false;

  const expected = `Bearer ${secret}`;
  const provided = authorizationHeader.trim();
  const expectedBuffer = Buffer.from(expected);
  const providedBuffer = Buffer.from(provided);
  if (expectedBuffer.length !== providedBuffer.length) return false;
  return crypto.timingSafeEqual(expectedBuffer, providedBuffer);
}
