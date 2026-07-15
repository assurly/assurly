import { describe, it, expect } from 'vitest';
import { isActiveProbeAllowed, normalizeUrlIdentifier } from './gate';

describe('isActiveProbeAllowed', () => {
  it('always allows the active probe for repo targets (implicit github_app ownership)', () => {
    expect(isActiveProbeAllowed({ kind: 'repo', ownershipVerified: false })).toBe(true);
    expect(isActiveProbeAllowed({ kind: 'repo', ownershipVerified: true })).toBe(true);
  });

  it('blocks the active probe for an unverified url target', () => {
    expect(isActiveProbeAllowed({ kind: 'url', ownershipVerified: false })).toBe(false);
  });

  it('allows the active probe for a verified url target', () => {
    expect(isActiveProbeAllowed({ kind: 'url', ownershipVerified: true })).toBe(true);
  });
});

describe('normalizeUrlIdentifier', () => {
  it('reduces a url to its origin so one verification covers the whole host', () => {
    expect(normalizeUrlIdentifier('https://app.com/dashboard?x=1')).toBe('https://app.com');
    expect(normalizeUrlIdentifier('https://app.com/')).toBe('https://app.com');
    expect(normalizeUrlIdentifier('https://app.com')).toBe('https://app.com');
  });

  it('keeps a non-default port as part of the origin', () => {
    expect(normalizeUrlIdentifier('https://app.com:8443/a')).toBe('https://app.com:8443');
  });
});
