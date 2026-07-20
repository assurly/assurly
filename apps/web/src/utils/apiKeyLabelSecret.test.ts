import { describe, expect, it } from 'vitest';
import { apiKeyLabelLooksLikeSecret } from './apiKeyLabelSecret';

describe('apiKeyLabelLooksLikeSecret', () => {
  it('flags known secret prefixes', () => {
    expect(apiKeyLabelLooksLikeSecret('sk-ant-api03-abcdefghijklmnopqrstuvwxyz')).toBe(true);
    expect(apiKeyLabelLooksLikeSecret('sk-proj-abcdefghijklmnopqrstuvwxyz')).toBe(true);
    expect(apiKeyLabelLooksLikeSecret('ghp_abcdefghijklmnopqrstuvwxyz012345')).toBe(true);
    expect(apiKeyLabelLooksLikeSecret('gho_abcdefghijklmnopqrstuvwxyz012345')).toBe(true);
    expect(apiKeyLabelLooksLikeSecret('github_pat_11AAAAAAAAabcdefghijklmnopqrstuv')).toBe(true);
    expect(apiKeyLabelLooksLikeSecret('xoxb-1234567890-abcdefghijklmnop')).toBe(true);
    expect(apiKeyLabelLooksLikeSecret('AKIAYOURACCESSKEYEXAMPLE')).toBe(true);
  });

  it('flags a high-entropy 40+ character token with mixed case and digits', () => {
    expect(apiKeyLabelLooksLikeSecret('AbCdEfGhIjKlMnOpQrStUvWxYz0123456789AbCd')).toBe(true);
  });

  it('does not flag ordinary human labels (false positives)', () => {
    expect(apiKeyLabelLooksLikeSecret('Cursor agent')).toBe(false);
    expect(apiKeyLabelLooksLikeSecret('prod-key-2026')).toBe(false);
    expect(apiKeyLabelLooksLikeSecret('OEM integration for Acme Corp')).toBe(false);
    expect(apiKeyLabelLooksLikeSecret('CI pipeline token placeholder')).toBe(false);
    expect(apiKeyLabelLooksLikeSecret('')).toBe(false);
    expect(apiKeyLabelLooksLikeSecret('   ')).toBe(false);
  });

  it('does not flag a long lowercase-only or digit-only string', () => {
    expect(apiKeyLabelLooksLikeSecret('abcdefghijklmnopqrstuvwxyz0123456789abcd')).toBe(false);
    expect(apiKeyLabelLooksLikeSecret('ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789ABCD')).toBe(false);
  });
});
