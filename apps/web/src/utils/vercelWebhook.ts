import crypto from 'node:crypto';
import { ConfigurationError } from './env';

/**
 * The Vercel account-webhook signing secret. Read lazily (never at boot) so the
 * app runs without it configured — only the deploy webhook needs it. Mirrors
 * `getGitHubWebhookSecret`.
 */
export function getVercelWebhookSecret(): string {
  const value = process.env.VERCEL_WEBHOOK_SECRET?.trim();
  if (!value) {
    throw new ConfigurationError(
      'VERCEL_WEBHOOK_SECRET is required for the Vercel deploy webhook.',
    );
  }
  return value;
}

/**
 * Verifies a Vercel webhook against `x-vercel-signature`. Vercel signs the RAW
 * request body with HMAC-SHA1 (hex, no prefix) — confirmed against Vercel's
 * request-headers docs. The route must therefore read the exact bytes
 * (bodyMode: 'raw') before parsing JSON, exactly like the GitHub webhook.
 */
export function verifyVercelWebhookSignature(
  body: string,
  signature: string | null,
  secret = getVercelWebhookSecret(),
): boolean {
  if (!signature || !/^[a-f0-9]{40}$/.test(signature)) return false;
  const expected = crypto.createHmac('sha1', secret).update(body).digest('hex');
  const signatureBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (signatureBuffer.length !== expectedBuffer.length) return false;
  return crypto.timingSafeEqual(signatureBuffer, expectedBuffer);
}

/**
 * Normalizes a candidate host or URL to an `https://<host>` origin, or null if
 * it is not a usable public host. Used only as a LOOKUP KEY against our own DB —
 * never as a probe target (the payload is untrusted; see api/vercel/webhook).
 */
export function normalizeDeployOrigin(candidate: string): string | null {
  const trimmed = candidate.trim();
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed.includes('://') ? trimmed : `https://${trimmed}`);
    if (url.protocol !== 'https:') return null;
    return url.origin;
  } catch {
    return null;
  }
}

/**
 * Extracts candidate deploy origins from a Vercel deployment webhook payload.
 * Pulls only the URL-shaped fields Vercel is known to send and returns their
 * normalized origins, de-duplicated. These are matched against our own verified
 * `url` targets; we never fetch any of them directly.
 */
export function extractDeployOrigins(payload: unknown): string[] {
  const origins = new Set<string>();
  const push = (value: unknown): void => {
    if (typeof value !== 'string') return;
    const origin = normalizeDeployOrigin(value);
    if (origin) origins.add(origin);
  };

  if (payload && typeof payload === 'object') {
    const root = payload as Record<string, unknown>;
    const inner = (root.payload && typeof root.payload === 'object' ? root.payload : {}) as Record<
      string,
      unknown
    >;
    const deployment = (
      inner.deployment && typeof inner.deployment === 'object' ? inner.deployment : {}
    ) as Record<string, unknown>;

    push(inner.url);
    push(deployment.url);
    push(deployment.name);
    for (const aliasList of [inner.alias, deployment.alias]) {
      if (Array.isArray(aliasList)) for (const alias of aliasList) push(alias);
    }
    const links = (inner.links && typeof inner.links === 'object' ? inner.links : {}) as Record<
      string,
      unknown
    >;
    push(links.deployment);
    push(links.project);
  }

  return [...origins];
}
