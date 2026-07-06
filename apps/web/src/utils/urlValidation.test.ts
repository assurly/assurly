import { describe, expect, it } from 'vitest';
import { isLikelyScannableUrl } from './urlValidation';

describe('isLikelyScannableUrl', () => {
  it('accepts well-formed http(s) URLs with a dotted host', () => {
    expect(isLikelyScannableUrl('https://myapp.lovable.app')).toBe(true);
    expect(isLikelyScannableUrl('http://example.com')).toBe(true);
    expect(isLikelyScannableUrl('  https://example.com/path?q=1  ')).toBe(true);
  });

  it('rejects empty, scheme-less, malformed, or non-http input', () => {
    expect(isLikelyScannableUrl('')).toBe(false);
    expect(isLikelyScannableUrl('   ')).toBe(false);
    expect(isLikelyScannableUrl('myapp.lovable.app')).toBe(false); // no scheme
    expect(isLikelyScannableUrl('not a url')).toBe(false);
    expect(isLikelyScannableUrl('ftp://example.com')).toBe(false);
    expect(isLikelyScannableUrl('javascript:alert(1)')).toBe(false);
  });

  it('rejects a host without a dot (e.g. bare localhost)', () => {
    expect(isLikelyScannableUrl('http://localhost')).toBe(false);
  });
});
