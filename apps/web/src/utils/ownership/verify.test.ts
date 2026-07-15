import { describe, it, expect, vi } from 'vitest';
import { verifyOwnership } from './verify';
import type { LookupImpl } from '../runtimeScanner';

const TOKEN = 'av_0123456789abcdef0123456789abcdef01234567';
const IDENTIFIER = 'https://app.example';

const publicLookup: LookupImpl = async () => [{ address: '203.0.113.10', family: 4 }];
const privateLookup: LookupImpl = async () => [{ address: '10.0.0.5', family: 4 }];

function htmlResponse(body: string, status = 200): Response {
  return new Response(body, { status, headers: { 'content-type': 'text/html' } });
}

describe('verifyOwnership - meta_tag', () => {
  it('verifies when the site exposes the matching meta tag', async () => {
    const fetchMock = vi.fn(async () =>
      htmlResponse(`<html><head><meta name="assurly-verify" content="${TOKEN}"></head></html>`),
    ) as unknown as typeof fetch;

    const result = await verifyOwnership('meta_tag', IDENTIFIER, TOKEN, {
      fetchImpl: fetchMock,
      lookupImpl: publicLookup,
    });
    expect(result).toBe(true);
  });

  it('matches regardless of attribute order', async () => {
    const fetchMock = vi.fn(async () =>
      htmlResponse(`<meta content="${TOKEN}" name="assurly-verify" />`),
    ) as unknown as typeof fetch;

    expect(
      await verifyOwnership('meta_tag', IDENTIFIER, TOKEN, {
        fetchImpl: fetchMock,
        lookupImpl: publicLookup,
      }),
    ).toBe(true);
  });

  it('fails when the token does not match', async () => {
    const fetchMock = vi.fn(async () =>
      htmlResponse('<meta name="assurly-verify" content="av_wrong">'),
    ) as unknown as typeof fetch;

    expect(
      await verifyOwnership('meta_tag', IDENTIFIER, TOKEN, {
        fetchImpl: fetchMock,
        lookupImpl: publicLookup,
      }),
    ).toBe(false);
  });

  it('fails on a non-ok response', async () => {
    const fetchMock = vi.fn(async () => htmlResponse('', 404)) as unknown as typeof fetch;
    expect(
      await verifyOwnership('meta_tag', IDENTIFIER, TOKEN, {
        fetchImpl: fetchMock,
        lookupImpl: publicLookup,
      }),
    ).toBe(false);
  });

  it('only ever issues a GET (never a mutating method)', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect((init?.method ?? 'GET').toUpperCase()).toBe('GET');
      return htmlResponse('<html></html>');
    }) as unknown as typeof fetch;

    await verifyOwnership('meta_tag', IDENTIFIER, TOKEN, {
      fetchImpl: fetchMock,
      lookupImpl: publicLookup,
    });
    expect(fetchMock).toHaveBeenCalled();
  });

  it('rejects a host that resolves to a private address (SSRF guard)', async () => {
    const fetchMock = vi.fn() as unknown as typeof fetch;
    await expect(
      verifyOwnership('meta_tag', IDENTIFIER, TOKEN, {
        fetchImpl: fetchMock,
        lookupImpl: privateLookup,
      }),
    ).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('verifyOwnership - dns_txt', () => {
  it('verifies when a TXT record matches', async () => {
    const resolveTxtImpl = vi.fn(async () => [['assurly-verify=' + TOKEN]]);
    expect(await verifyOwnership('dns_txt', IDENTIFIER, TOKEN, { resolveTxtImpl })).toBe(true);
    expect(resolveTxtImpl).toHaveBeenCalledWith('app.example');
  });

  it('joins chunked TXT records before comparing', async () => {
    const resolveTxtImpl = vi.fn(async () => [['assurly-verify=', TOKEN]]);
    expect(await verifyOwnership('dns_txt', IDENTIFIER, TOKEN, { resolveTxtImpl })).toBe(true);
  });

  it('fails when no TXT record matches', async () => {
    const resolveTxtImpl = vi.fn(async () => [['something-else']]);
    expect(await verifyOwnership('dns_txt', IDENTIFIER, TOKEN, { resolveTxtImpl })).toBe(false);
  });

  it('fails (never throws) when the DNS lookup errors', async () => {
    const resolveTxtImpl = vi.fn(async () => {
      throw new Error('ENOTFOUND');
    });
    expect(await verifyOwnership('dns_txt', IDENTIFIER, TOKEN, { resolveTxtImpl })).toBe(false);
  });
});

describe('verifyOwnership - file', () => {
  it('verifies when the well-known file contains the token', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      expect(String(input)).toContain('/.well-known/assurly-verify.txt');
      return new Response(TOKEN, { status: 200 });
    }) as unknown as typeof fetch;

    expect(
      await verifyOwnership('file', IDENTIFIER, TOKEN, {
        fetchImpl: fetchMock,
        lookupImpl: publicLookup,
      }),
    ).toBe(true);
  });

  it('fails when the file does not contain the token', async () => {
    const fetchMock = vi.fn(
      async () => new Response('nope', { status: 200 }),
    ) as unknown as typeof fetch;
    expect(
      await verifyOwnership('file', IDENTIFIER, TOKEN, {
        fetchImpl: fetchMock,
        lookupImpl: publicLookup,
      }),
    ).toBe(false);
  });
});
