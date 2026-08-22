import { describe, expect, it } from 'vitest';
import {
  describeBlockedScan,
  parseBlockedScan,
  SCANNER_IDENTITY_HEADER,
  type BlockedScanSource,
} from './scannerBlocked';

describe('parseBlockedScan', () => {
  it('accepts a well-formed payload', () => {
    expect(parseBlockedScan({ status: 403, source: 'cloudflare' })).toEqual({
      status: 403,
      source: 'cloudflare',
    });
  });

  it('rejects anything that is not a recognised blocked payload', () => {
    expect(parseBlockedScan(undefined)).toBeNull();
    expect(parseBlockedScan(null)).toBeNull();
    expect(parseBlockedScan('403')).toBeNull();
    expect(parseBlockedScan({ status: 403 })).toBeNull();
    expect(parseBlockedScan({ source: 'cloudflare' })).toBeNull();
    expect(parseBlockedScan({ status: '403', source: 'cloudflare' })).toBeNull();
    expect(parseBlockedScan({ status: 403.5, source: 'cloudflare' })).toBeNull();
    expect(parseBlockedScan({ status: 403, source: 'akamai' })).toBeNull();
  });
});

describe('describeBlockedScan', () => {
  const sources: BlockedScanSource[] = ['cloudflare', 'vercel', 'rate-limit', 'unknown'];

  it('names the status and never claims the app is broken', () => {
    for (const source of sources) {
      const copy = describeBlockedScan({ status: 403, source });
      expect(copy.title).not.toBe('');
      expect(copy.detail).toContain('403');
      expect(copy.nextStep).not.toBe('');
      // The honest-unknown state must not read as a verdict in either direction.
      expect(copy.detail.toLowerCase()).not.toContain('not live');
      expect(copy.detail.toLowerCase()).not.toContain('unreachable');
    }
  });

  it('tells the user how to let the scanner in, naming the allowlist header', () => {
    expect(describeBlockedScan({ status: 403, source: 'cloudflare' }).nextStep).toContain(
      SCANNER_IDENTITY_HEADER,
    );
    expect(describeBlockedScan({ status: 401, source: 'vercel' }).nextStep).toContain(
      SCANNER_IDENTITY_HEADER,
    );
  });

  it('tells a rate-limited user to retry instead of reconfiguring their host', () => {
    const copy = describeBlockedScan({ status: 429, source: 'rate-limit' });
    expect(copy.nextStep).toMatch(/again/i);
    expect(copy.nextStep).not.toContain(SCANNER_IDENTITY_HEADER);
  });
});
