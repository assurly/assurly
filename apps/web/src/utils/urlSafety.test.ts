import { describe, it, expect } from 'vitest';
import {
  assertPublicIpAddress,
  assertScannableUrl,
  isPrivateOrBlockedHost,
  UrlSafetyError,
} from './urlSafety';

describe('urlSafety', () => {
  it('accepts valid public https URLs', () => {
    const url = assertScannableUrl('https://myapp.lovable.app');
    expect(url.hostname).toBe('myapp.lovable.app');
    expect(url.protocol).toBe('https:');
  });

  it('accepts valid public http URLs', () => {
    const url = assertScannableUrl('http://example.com/path');
    expect(url.hostname).toBe('example.com');
  });

  it('rejects malformed URLs', () => {
    expect(() => assertScannableUrl('not-a-url')).toThrow(UrlSafetyError);
    expect(() => assertScannableUrl('')).toThrow(UrlSafetyError);
  });

  it('rejects non-http(s) schemes', () => {
    expect(() => assertScannableUrl('file:///etc/passwd')).toThrow(UrlSafetyError);
    expect(() => assertScannableUrl('ftp://example.com')).toThrow(UrlSafetyError);
    expect(() => assertScannableUrl('javascript:alert(1)')).toThrow(UrlSafetyError);
  });

  it('rejects loopback hosts', () => {
    expect(() => assertScannableUrl('http://localhost')).toThrow(UrlSafetyError);
    expect(() => assertScannableUrl('http://127.0.0.1')).toThrow(UrlSafetyError);
    expect(() => assertScannableUrl('http://[::1]')).toThrow(UrlSafetyError);
  });

  it('rejects link-local metadata addresses', () => {
    expect(() => assertScannableUrl('http://169.254.169.254')).toThrow(UrlSafetyError);
    expect(isPrivateOrBlockedHost('169.254.169.254')).toBe(true);
  });

  it('rejects private IPv4 ranges', () => {
    expect(() => assertScannableUrl('http://10.0.0.1')).toThrow(UrlSafetyError);
    expect(() => assertScannableUrl('http://172.16.0.5')).toThrow(UrlSafetyError);
    expect(() => assertScannableUrl('http://192.168.1.20')).toThrow(UrlSafetyError);
  });

  it('rejects credentials in URLs', () => {
    expect(() => assertScannableUrl('https://user:pass@example.com')).toThrow(UrlSafetyError);
  });

  it('blocks resolved private addresses via assertPublicIpAddress', () => {
    expect(() => assertPublicIpAddress('10.1.2.3')).toThrow(UrlSafetyError);
    expect(() => assertPublicIpAddress('8.8.8.8')).not.toThrow();
  });

  // An IPv6 address can carry an IPv4 one, and a dual-stack socket connects to
  // the IPv4 address inside. A DNS AAAA record of ::ffff:169.254.169.254 must be
  // judged as 169.254.169.254.
  it.each([
    '::',
    '::ffff:127.0.0.1',
    '::ffff:7f00:1',
    '::ffff:169.254.169.254',
    '::ffff:a9fe:a9fe',
    '::ffff:10.0.0.1',
    '0:0:0:0:0:ffff:192.168.1.1',
    '::127.0.0.1',
    '64:ff9b::a9fe:a9fe',
    '64:ff9b:1::1',
    '2002:7f00:1::',
    'ff02::1',
    'fec0::1',
    'fe80::1%eth0',
  ])('rejects the IPv6 address %s, which reaches a private or local network', (address) => {
    expect(isPrivateOrBlockedHost(address)).toBe(true);
    expect(() => assertPublicIpAddress(address)).toThrow(UrlSafetyError);
  });

  it.each(['https://[::ffff:127.0.0.1]/', 'https://[::]/', 'https://[64:ff9b::a9fe:a9fe]/'])(
    'rejects the IPv6 URL literal %s',
    (url) => {
      expect(() => assertScannableUrl(url)).toThrow(UrlSafetyError);
    },
  );

  it.each(['2606:4700:4700::1111', '::ffff:8.8.8.8', '64:ff9b::808:808', '2002:808:808::1'])(
    'still allows the public IPv6 address %s',
    (address) => {
      expect(isPrivateOrBlockedHost(address)).toBe(false);
    },
  );

  it('rejects IPv4 multicast and reserved space', () => {
    expect(isPrivateOrBlockedHost('224.0.0.1')).toBe(true);
    expect(isPrivateOrBlockedHost('255.255.255.255')).toBe(true);
  });
});
