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
});
