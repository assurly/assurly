import { describe, expect, it } from 'vitest';
import { scanEnvVariables } from './index';
import {
  ASSURLY_CANARY_PREFIX,
  containsAssurlyCanaryToken,
  isAssurlyCanaryToken,
} from './canaryToken';

const PLANTED = `${ASSURLY_CANARY_PREFIX}${'a'.repeat(32)}`;

describe('canary token recognition', () => {
  it('accepts a well-formed canary', () => {
    expect(isAssurlyCanaryToken(PLANTED)).toBe(true);
    expect(containsAssurlyCanaryToken(`SECRET=${PLANTED}`)).toBe(true);
  });

  it('rejects malformed candidates', () => {
    expect(isAssurlyCanaryToken('ask_canary_short')).toBe(false);
    expect(isAssurlyCanaryToken('ask_live_abcdefghijklmnop')).toBe(false);
  });
});

describe('canary vs secret scanner conflict', () => {
  it('does not report a planted canary as a secret leak', () => {
    const example = [
      '# Planted Assurly canary — expected in the repo',
      `ASSURLY_CANARY=${PLANTED}`,
      // A real Stripe leak still fires beside the canary.
      'STRIPE_SECRET_KEY=sk_live_REALLEAKSHOULDSTILLFIRE1234567890',
    ].join('\n');

    const result = scanEnvVariables(example, 'const x = 1;', '.env.example', 'code.ts');
    const canaryFindings = result.findings.filter((f) => f.ruleId === 'assurly-canary-planted');
    const leakFindings = result.findings.filter((f) => f.ruleId === 'stripe-secret-leak');

    expect(canaryFindings).toHaveLength(1);
    expect(canaryFindings[0]!.severity).toBe('warning');
    expect(canaryFindings[0]!.confidence).toBe('high');
    expect(canaryFindings[0]!.message).toMatch(/canary/i);
    expect(canaryFindings[0]!.message).not.toContain(PLANTED);

    // Canary must not be classified as a leak.
    expect(
      result.findings.some(
        (f) =>
          f.severity === 'error' &&
          (f.message.includes('ask_canary_') || f.message.includes(PLANTED)),
      ),
    ).toBe(false);

    // A real Stripe key on another line still blocks.
    expect(leakFindings.length).toBeGreaterThanOrEqual(1);
  });
});
