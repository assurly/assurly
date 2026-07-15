import { describe, it, expect } from 'vitest';
import {
  OWNERSHIP_FILE_PATH,
  OWNERSHIP_META_NAME,
  OWNERSHIP_TXT_PREFIX,
  deriveOwnershipToken,
} from './token';

const baseInput = {
  organizationId: 'org-1',
  targetId: '11111111-1111-1111-1111-111111111111',
  identifier: 'https://app.com',
};

describe('deriveOwnershipToken', () => {
  it('is deterministic for the same target', () => {
    expect(deriveOwnershipToken(baseInput)).toBe(deriveOwnershipToken(baseInput));
  });

  it('has the expected prefixed shape', () => {
    expect(deriveOwnershipToken(baseInput)).toMatch(/^av_[0-9a-f]{40}$/);
  });

  it('differs when the target id differs (a token cannot be replayed across targets)', () => {
    const other = deriveOwnershipToken({
      ...baseInput,
      targetId: '22222222-2222-2222-2222-222222222222',
    });
    expect(other).not.toBe(deriveOwnershipToken(baseInput));
  });

  it('differs when the organization differs', () => {
    const other = deriveOwnershipToken({ ...baseInput, organizationId: 'org-2' });
    expect(other).not.toBe(deriveOwnershipToken(baseInput));
  });
});

describe('challenge constants', () => {
  it('exposes the documented meta/dns/file identifiers', () => {
    expect(OWNERSHIP_META_NAME).toBe('assurly-verify');
    expect(OWNERSHIP_TXT_PREFIX).toBe('assurly-verify=');
    expect(OWNERSHIP_FILE_PATH).toBe('/.well-known/assurly-verify.txt');
  });
});
