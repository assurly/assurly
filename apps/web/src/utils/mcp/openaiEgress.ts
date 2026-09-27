import { isIP } from 'node:net';
import { z } from 'zod';

/**
 * Addresses ChatGPT uses to call MCP servers. Like Anthropic's range, they are
 * shared by every ChatGPT user, so they must not get one per-address bucket.
 * OpenAI changes the list and asks integrators to follow the feed rather than
 * copy it: https://developers.openai.com/api/docs/guides/ip-addresses
 */
export const OPENAI_CONNECTOR_RANGES_URL = 'https://openai.com/chatgpt-connectors.json';

const REFRESH_MS = 6 * 60 * 60 * 1000;
/** After a failed fetch, try again after this long rather than on every request. */
const RETRY_MS = 5 * 60 * 1000;
const FETCH_TIMEOUT_MS = 2000;

interface Ipv4Range {
  network: number;
  mask: number;
}

interface RangeCache {
  ranges: readonly Ipv4Range[];
  nextRefreshAt: number;
}

const feedSchema = z.object({
  prefixes: z.array(z.object({ ipv4Prefix: z.string().optional() })),
});

let cache: RangeCache | null = null;
let refreshing: Promise<RangeCache> | null = null;

function ipv4ToInt(ip: string): number {
  return ip.split('.').reduce((value, octet) => ((value << 8) | Number(octet)) >>> 0, 0);
}

export function parseIpv4Prefix(prefix: string): Ipv4Range | null {
  const [address, bits] = prefix.split('/');
  const length = Number(bits);
  if (isIP(address) !== 4 || !Number.isInteger(length) || length < 0 || length > 32) return null;
  // `<< 32` is `<< 0` in JavaScript, so /0 needs its own case.
  const mask = length === 0 ? 0 : (0xffffffff << (32 - length)) >>> 0;
  return { network: (ipv4ToInt(address) & mask) >>> 0, mask };
}

async function loadRanges(fetchImpl: typeof fetch, now: number): Promise<RangeCache> {
  try {
    const response = await fetchImpl(OPENAI_CONNECTOR_RANGES_URL, {
      cache: 'no-store',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const { prefixes } = feedSchema.parse(await response.json());
    const ranges = prefixes.flatMap(({ ipv4Prefix }) => {
      const range = ipv4Prefix ? parseIpv4Prefix(ipv4Prefix) : null;
      return range ? [range] : [];
    });
    return { ranges, nextRefreshAt: now + REFRESH_MS };
  } catch (error) {
    console.warn(
      JSON.stringify({
        service: 'assurly-mcp',
        outcome: 'openai_ranges_unavailable',
        errorMessage: error instanceof Error ? error.message : String(error),
      }),
    );
    // Keep the last good list. Without one, ChatGPT callers get per-address
    // limits until the next try — slower for them, never unbounded for us.
    return { ranges: cache?.ranges ?? [], nextRefreshAt: now + RETRY_MS };
  }
}

export async function isOpenAiConnectorAddress(
  ip: string,
  fetchImpl: typeof fetch = fetch,
  now: number = Date.now(),
): Promise<boolean> {
  if (isIP(ip) !== 4) return false;
  if (!cache || now >= cache.nextRefreshAt) {
    refreshing ??= loadRanges(fetchImpl, now).finally(() => {
      refreshing = null;
    });
    cache = await refreshing;
  }
  const address = ipv4ToInt(ip);
  return cache.ranges.some((range) => (address & range.mask) >>> 0 === range.network);
}

export function resetOpenAiRangesForTests(): void {
  cache = null;
  refreshing = null;
}
