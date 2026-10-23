import crypto from 'node:crypto';
import { getApplicationUrl } from './env';
import { getVercelTokenKey } from './vercelToken';

const STATE_TTL_MS = 10 * 60 * 1000;

export function vercelRedirectUri(): string {
  return `${getApplicationUrl()}/api/vercel/callback`;
}

export function vercelAuthorizeUrl(state: string): string {
  const clientId = process.env.VERCEL_CLIENT_ID?.trim() ?? '';
  const url = new URL('https://vercel.com/oauth/authorize');
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', vercelRedirectUri());
  url.searchParams.set('state', state);
  return url.toString();
}

export function signVercelState(organizationId: string, now = Date.now()): string {
  const expiresAt = now + STATE_TTL_MS;
  const body = `${organizationId}.${expiresAt}`;
  const mac = crypto.createHmac('sha256', getVercelTokenKey()).update(body).digest('base64url');
  return `${body}.${mac}`;
}

export function readVercelState(state: string, now = Date.now()): string | null {
  const parts = state.split('.');
  if (parts.length !== 3) return null;
  const [organizationId, expiresAtRaw, mac] = parts;
  if (!organizationId || !expiresAtRaw || !mac) return null;
  if (!/^[0-9a-f-]{36}$/i.test(organizationId)) return null;
  const expiresAt = Number(expiresAtRaw);
  if (!Number.isFinite(expiresAt) || expiresAt < now) return null;
  const body = `${organizationId}.${expiresAtRaw}`;
  const expected = crypto
    .createHmac('sha256', getVercelTokenKey())
    .update(body)
    .digest('base64url');
  const left = Buffer.from(mac);
  const right = Buffer.from(expected);
  if (left.length !== right.length || !crypto.timingSafeEqual(left, right)) return null;
  return organizationId;
}
