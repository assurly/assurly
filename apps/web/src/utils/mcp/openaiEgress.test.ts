import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  isOpenAiConnectorAddress,
  OPENAI_CONNECTOR_RANGES_URL,
  parseIpv4Prefix,
  resetOpenAiRangesForTests,
} from './openaiEgress';

const HOUR = 60 * 60 * 1000;

function feed(prefixes: unknown[]): typeof fetch {
  return vi.fn(async () => Response.json({ creationTime: '2026-09-22T18:18:05', prefixes }));
}

const FEED = feed([
  { ipv4Prefix: '104.210.139.192/28' },
  { ipv4Prefix: '12.12.47.194/32' },
  { ipv6Prefix: '2603:1030::/32' },
  { ipv4Prefix: 'not-a-prefix' },
]);

describe('parseIpv4Prefix', () => {
  it('reads CIDR prefixes, including the /0 and /32 edges', () => {
    expect(parseIpv4Prefix('10.0.0.0/8')).toEqual({ network: 0x0a000000, mask: 0xff000000 });
    expect(parseIpv4Prefix('0.0.0.0/0')).toEqual({ network: 0, mask: 0 });
    expect(parseIpv4Prefix('1.2.3.4/32')).toEqual({ network: 0x01020304, mask: 0xffffffff });
  });

  it('rejects anything that is not an IPv4 prefix', () => {
    expect(parseIpv4Prefix('1.2.3.4')).toBeNull();
    expect(parseIpv4Prefix('1.2.3.4/33')).toBeNull();
    expect(parseIpv4Prefix('2001:db8::/32')).toBeNull();
    expect(parseIpv4Prefix('garbage/8')).toBeNull();
  });
});

describe('isOpenAiConnectorAddress', () => {
  beforeEach(() => {
    resetOpenAiRangesForTests();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  it('matches addresses inside the published prefixes and nothing next to them', async () => {
    expect(await isOpenAiConnectorAddress('104.210.139.192', FEED, 0)).toBe(true);
    expect(await isOpenAiConnectorAddress('104.210.139.207', FEED, 0)).toBe(true);
    expect(await isOpenAiConnectorAddress('104.210.139.208', FEED, 0)).toBe(false);
    expect(await isOpenAiConnectorAddress('12.12.47.194', FEED, 0)).toBe(true);
    expect(await isOpenAiConnectorAddress('12.12.47.195', FEED, 0)).toBe(false);
    expect(await isOpenAiConnectorAddress('unknown', FEED, 0)).toBe(false);
    expect(await isOpenAiConnectorAddress('2603:1030::1', FEED, 0)).toBe(false);
  });

  it('fetches the feed once, even for concurrent callers, until it is due for a refresh', async () => {
    const fetchImpl = feed([{ ipv4Prefix: '12.12.47.194/32' }]);
    await Promise.all([
      isOpenAiConnectorAddress('12.12.47.194', fetchImpl, 0),
      isOpenAiConnectorAddress('12.12.47.194', fetchImpl, 0),
    ]);
    await isOpenAiConnectorAddress('12.12.47.194', fetchImpl, 5 * HOUR);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledWith(OPENAI_CONNECTOR_RANGES_URL, expect.anything());

    await isOpenAiConnectorAddress('12.12.47.194', fetchImpl, 7 * HOUR);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('keeps the last good list when a refresh fails', async () => {
    expect(await isOpenAiConnectorAddress('12.12.47.194', FEED, 0)).toBe(true);
    const failing = vi.fn(async () => new Response('down', { status: 503 }));
    expect(await isOpenAiConnectorAddress('12.12.47.194', failing, 7 * HOUR)).toBe(true);
    expect(failing).toHaveBeenCalledTimes(1);
  });

  it('treats every address as ordinary when the feed was never read, and retries later', async () => {
    const failing = vi.fn(async () => Promise.reject(new TypeError('fetch failed')));
    expect(await isOpenAiConnectorAddress('12.12.47.194', failing, 0)).toBe(false);
    expect(await isOpenAiConnectorAddress('12.12.47.194', failing, 60_000)).toBe(false);
    expect(failing).toHaveBeenCalledTimes(1);

    expect(await isOpenAiConnectorAddress('12.12.47.194', FEED, 6 * 60_000)).toBe(true);
  });

  it('ignores a feed that does not have the published shape', async () => {
    const wrongShape = vi.fn(async () => Response.json({ prefixes: 'everything' }));
    expect(await isOpenAiConnectorAddress('12.12.47.194', wrongShape, 0)).toBe(false);
  });
});
