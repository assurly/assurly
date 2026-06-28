import { describe, expect, it } from 'vitest';
import { COOKIE_NAME } from './sessionCookie';
import { COOKIE_INVENTORY, COOKIE_POLICY_VERSION } from './cookieInventory';

describe('cookieInventory', () => {
  it('documents the canonical session cookie by name', () => {
    const session = COOKIE_INVENTORY.find((entry) => entry.name === COOKIE_NAME);
    expect(session).toBeTruthy();
    expect(session?.category).toBe('strictly-necessary');
  });

  it('includes PKCE and legacy cleanup entries for OAuth transparency', () => {
    expect(COOKIE_INVENTORY.some((entry) => entry.name.includes('code-verifier'))).toBe(true);
    expect(COOKIE_INVENTORY.some((entry) => entry.name.includes('legacy'))).toBe(true);
  });

  it('uses a dated policy version for notice re-display', () => {
    expect(COOKIE_POLICY_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
