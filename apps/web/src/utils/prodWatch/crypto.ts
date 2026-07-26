import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'node:crypto';
import { ConfigurationError } from '../env';

const ALGO = 'aes-256-gcm';
const IV_BYTES = 12;

/**
 * Encrypt a customer-supplied Management API token for at-rest storage.
 * Format: base64(iv || authTag || ciphertext). Plaintext is never logged.
 */
export function encryptProdWatchToken(
  plaintext: string,
  secret: string = getProdWatchTokenSecret(),
): string {
  const key = deriveKey(secret);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGO, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString('base64');
}

export function decryptProdWatchToken(
  ciphertext: string,
  secret: string = getProdWatchTokenSecret(),
): string {
  const raw = Buffer.from(ciphertext, 'base64');
  if (raw.length < IV_BYTES + 16 + 1) {
    throw new Error('Prod Watch token ciphertext is malformed.');
  }
  const iv = raw.subarray(0, IV_BYTES);
  const tag = raw.subarray(IV_BYTES, IV_BYTES + 16);
  const data = raw.subarray(IV_BYTES + 16);
  const key = deriveKey(secret);
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}

export function getProdWatchTokenSecret(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const dedicated = env.PROD_WATCH_TOKEN_SECRET?.trim();
  if (dedicated) return dedicated;
  const ownership = env.OWNERSHIP_TOKEN_SECRET?.trim();
  if (ownership) return ownership;
  const serviceRole = env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (serviceRole) return serviceRole;
  if (env.NODE_ENV === 'production') {
    throw new ConfigurationError(
      'PROD_WATCH_TOKEN_SECRET (or OWNERSHIP_TOKEN_SECRET / SUPABASE_SERVICE_ROLE_KEY) is required to store Prod Watch credentials.',
    );
  }
  return 'assurly-dev-prod-watch-secret';
}

function deriveKey(secret: string): Buffer {
  return createHash('sha256').update(secret, 'utf8').digest();
}

/** Supabase project refs are lowercase alphanumeric, typically 20 chars. */
export function isValidSupabaseProjectRef(ref: string): boolean {
  return /^[a-z0-9]{10,32}$/.test(ref);
}
