import crypto from 'node:crypto';
import { ConfigurationError } from './env';

const VERSION = 'v1';

/** 32-byte key from `VERCEL_TOKEN_KEY` (base64). Used only on the server. */
export function getVercelTokenKey(): Buffer {
  const raw = process.env.VERCEL_TOKEN_KEY?.trim();
  if (!raw) {
    throw new ConfigurationError('VERCEL_TOKEN_KEY is required to store a Vercel connection.');
  }
  const key = Buffer.from(raw, 'base64');
  if (key.length !== 32) {
    throw new ConfigurationError('VERCEL_TOKEN_KEY must be 32 bytes of base64.');
  }
  return key;
}

/** AES-256-GCM. The token never sits in a column the Data API can select. */
export function encryptVercelToken(plaintext: string, key: Buffer = getVercelTokenKey()): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    VERSION,
    iv.toString('base64url'),
    tag.toString('base64url'),
    ciphertext.toString('base64url'),
  ].join('.');
}

export function decryptVercelToken(payload: string, key: Buffer = getVercelTokenKey()): string {
  const [version, ivPart, tagPart, body] = payload.split('.');
  if (version !== VERSION || !ivPart || !tagPart || !body) {
    throw new Error('Vercel token payload is invalid.');
  }
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivPart, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagPart, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(body, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}
