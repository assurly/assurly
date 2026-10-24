import crypto from 'node:crypto';
import { getVercelTokenKey } from './vercelToken';

const STATE_TTL_MS = 30 * 60 * 1000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface VercelInstallState {
  organizationId: string;
  targetId: string;
}

function mac(body: string): string {
  return crypto.createHmac('sha256', getVercelTokenKey()).update(body).digest('base64url');
}

/**
 * The `state` Vercel hands back after an external install. It names the
 * workspace and the guarded URL the install started from, so the callback
 * can lock that URL without asking again. 30 minutes matches the code TTL.
 */
export function signVercelInstallState(state: VercelInstallState, now = Date.now()): string {
  const body = `${state.organizationId}.${state.targetId}.${now + STATE_TTL_MS}`;
  return `${body}.${mac(body)}`;
}

export function readVercelInstallState(value: string, now = Date.now()): VercelInstallState | null {
  const parts = value.split('.');
  if (parts.length !== 4) return null;
  const [organizationId, targetId, expiresAtRaw, signature] = parts;
  if (!organizationId || !targetId || !expiresAtRaw || !signature) return null;
  if (!UUID.test(organizationId) || !UUID.test(targetId)) return null;
  const expiresAt = Number(expiresAtRaw);
  if (!Number.isFinite(expiresAt) || expiresAt < now) return null;
  const expected = Buffer.from(mac(`${organizationId}.${targetId}.${expiresAtRaw}`));
  const actual = Buffer.from(signature);
  if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) return null;
  return { organizationId, targetId };
}
