import crypto from 'node:crypto';
import { getOwnershipTokenSecret } from '../env';

/** The `name` attribute of the ownership meta tag the user adds to their site. */
export const OWNERSHIP_META_NAME = 'assurly-verify';

/** Prefix of the DNS TXT record the user adds (`assurly-verify=<token>`). */
export const OWNERSHIP_TXT_PREFIX = 'assurly-verify=';

/** Path of the well-known file the user hosts (`file` method). */
export const OWNERSHIP_FILE_PATH = '/.well-known/assurly-verify.txt';

export interface OwnershipTokenInput {
  organizationId: string;
  targetId: string;
  identifier: string;
}

/**
 * Derives the stable, unforgeable verification token for a single target.
 *
 * Deterministic (HMAC of the org + target id + identifier under a server
 * secret): the same target always yields the same token, so the user can add it
 * once and re-verify later, while a token shown on one site can never be
 * replayed to verify a different target. The token is public by design — the
 * target row itself is RLS-protected, so possessing the token grants nothing.
 */
export function deriveOwnershipToken(input: OwnershipTokenInput): string {
  const hmac = crypto.createHmac('sha256', getOwnershipTokenSecret());
  hmac.update(`${input.organizationId}:${input.targetId}:${input.identifier}`);
  return `av_${hmac.digest('hex').slice(0, 40)}`;
}
