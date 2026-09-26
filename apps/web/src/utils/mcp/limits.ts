import { isIP } from 'node:net';
import { enforceKeyedRateLimit, type RateLimitPolicy, type RateLimitResult } from '../rateLimit';

/**
 * Budgets for the public MCP connector. Every Claude user reaches us from
 * Anthropic's published egress range, so a per-address limit there would let
 * one busy minute lock out all of them at once. Those addresses skip the
 * per-address buckets; the per-site and global budgets bound them instead.
 */
export const MCP_LIMITS = {
  /** Any MCP message from one address outside Anthropic's range. */
  requestsPerClient: { limit: 120, windowSeconds: 60 },
  /** Scans from one address outside Anthropic's range — the website's scan limit. */
  scansPerClient: { limit: 5, windowSeconds: 60 },
  /** Scans of one site by everyone together: nobody can aim Assurly at a site repeatedly. */
  scansPerTarget: { limit: 6, windowSeconds: 600 },
  /** Ceiling on what the public connector can cost. */
  scansPerMinute: { limit: 30, windowSeconds: 60 },
  scansPerDay: { limit: 2000, windowSeconds: 86_400 },
} as const satisfies Record<string, RateLimitPolicy>;

export type ScanRefusal = 'client' | 'target' | 'capacity';

export type Allowance =
  | { allowed: true }
  | { allowed: false; reason: ScanRefusal; retryAfterSeconds: number };

/** Refusal reason, rate-limit route id, policy, identity. */
type LimitCheck = [ScanRefusal, string, RateLimitPolicy, string];

type Consume = (
  routeId: string,
  policy: RateLimitPolicy,
  identity: string,
) => Promise<RateLimitResult>;

/**
 * 160.79.104.0/21, from
 * https://claude.com/docs/connectors/building/authentication#network-reference
 *
 * Trusting this depends on the client address being unforgeable: getClientIp
 * reads x-forwarded-for, which Vercel overwrites with the real client address
 * (vercel.com/docs/headers/request-headers). Behind a proxy that passes a
 * client-sent value through, anyone could claim to be Claude here.
 */
export function isAnthropicEgressAddress(ip: string): boolean {
  if (isIP(ip) !== 4) return false;
  const [a, b, c] = ip.split('.').map(Number);
  return a === 160 && b === 79 && c >= 104 && c <= 111;
}

/** `www.`, letter case and a trailing dot all name the same site. */
export function targetKey(hostname: string): string {
  return hostname
    .toLowerCase()
    .replace(/\.$/, '')
    .replace(/^www\./, '');
}

function refusal(reason: ScanRefusal, result: RateLimitResult): Allowance {
  const nowSeconds = Math.floor(Date.now() / 1000);
  return { allowed: false, reason, retryAfterSeconds: Math.max(1, result.resetAt - nowSeconds) };
}

export async function allowMcpRequest(
  clientIp: string,
  consume: Consume = enforceKeyedRateLimit,
): Promise<Allowance> {
  if (isAnthropicEgressAddress(clientIp)) return { allowed: true };
  const result = await consume(
    'mcp:request:client',
    MCP_LIMITS.requestsPerClient,
    `ip:${clientIp}`,
  );
  return result.allowed ? { allowed: true } : refusal('client', result);
}

/**
 * Checked in order and stopped at the first refusal, so a refused scan does
 * not also spend the later budgets.
 */
export async function allowScan(
  clientIp: string,
  hostname: string,
  consume: Consume = enforceKeyedRateLimit,
): Promise<Allowance> {
  const clientChecks: LimitCheck[] = isAnthropicEgressAddress(clientIp)
    ? []
    : [['client', 'mcp:scan:client', MCP_LIMITS.scansPerClient, `ip:${clientIp}`]];
  const checks: LimitCheck[] = [
    ...clientChecks,
    ['target', 'mcp:scan:target', MCP_LIMITS.scansPerTarget, `host:${targetKey(hostname)}`],
    ['capacity', 'mcp:scan:minute', MCP_LIMITS.scansPerMinute, 'all'],
    ['capacity', 'mcp:scan:day', MCP_LIMITS.scansPerDay, 'all'],
  ];
  for (const [reason, routeId, policy, identity] of checks) {
    const result = await consume(routeId, policy, identity);
    if (!result.allowed) return refusal(reason, result);
  }
  return { allowed: true };
}
