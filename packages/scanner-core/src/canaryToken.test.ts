import { describe, expect, it } from 'vitest';
import { scanEnvVariables } from './index';
import {
  ASSURLY_CANARY_CALLBACK_PATH,
  ASSURLY_CANARY_ENV_KEY,
  ASSURLY_CANARY_PREFIX,
  containsAssurlyCanaryCallbackPath,
  containsAssurlyCanaryToken,
  isAssurlyCanaryEnvKey,
  isAssurlyCanaryMcpUrl,
  isAssurlyCanaryPlantLine,
  isAssurlyCanaryToken,
  mergeCanaryPlantIntoEnvExample,
} from './canaryToken';

const PLANTED = `${ASSURLY_CANARY_PREFIX}${'a'.repeat(32)}`;
const CALLBACK = `https://assurly.dev${ASSURLY_CANARY_CALLBACK_PATH}${PLANTED}`;
/** Built at runtime so GitHub secret scanning does not reject the upload. */
const FAKE_STRIPE_LIVE_LEAK = `sk_${'live'}_${'REALLEAKSHOULDSTILLFIRE'}${'1234567890'}`;

describe('canary token recognition', () => {
  it('accepts a well-formed canary', () => {
    expect(isAssurlyCanaryToken(PLANTED)).toBe(true);
    expect(containsAssurlyCanaryToken(`SECRET=${PLANTED}`)).toBe(true);
  });

  it('rejects malformed candidates', () => {
    expect(isAssurlyCanaryToken('ask_canary_short')).toBe(false);
    expect(isAssurlyCanaryToken('ask_live_abcdefghijklmnop')).toBe(false);
  });

  it('recognises the tripwire env key and callback path', () => {
    expect(isAssurlyCanaryEnvKey(ASSURLY_CANARY_ENV_KEY)).toBe(true);
    expect(isAssurlyCanaryEnvKey('STRIPE_SECRET_KEY')).toBe(false);
    expect(containsAssurlyCanaryCallbackPath(CALLBACK)).toBe(true);
    expect(isAssurlyCanaryPlantLine(`${ASSURLY_CANARY_ENV_KEY}=${CALLBACK}`)).toBe(true);
    expect(isAssurlyCanaryPlantLine(`STRIPE_SECRET_KEY=sk_live_${'x'.repeat(24)}`)).toBe(false);
  });
});

describe('canary vs secret scanner conflict', () => {
  it('does not report a planted canary as a secret leak', () => {
    const example = [
      '# Planted Assurly canary — expected in the repo',
      `ASSURLY_CANARY=${PLANTED}`,
      // A real Stripe leak still fires beside the canary.
      `STRIPE_SECRET_KEY=${FAKE_STRIPE_LIVE_LEAK}`,
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

  it('warns when .env.example exists without a silent alarm, and never blocks', () => {
    const example = ['DATABASE_URL=', `STRIPE_SECRET_KEY=${FAKE_STRIPE_LIVE_LEAK}`].join('\n');

    const result = scanEnvVariables(example, 'const x = 1;', '.env.example', 'code.ts');
    const missing = result.findings.filter((f) => f.ruleId === 'assurly-canary-missing');
    const leakFindings = result.findings.filter((f) => f.ruleId === 'stripe-secret-leak');

    expect(missing).toHaveLength(1);
    expect(missing[0]!.severity).toBe('warning');
    expect(missing[0]!.confidence).toBe('high');
    expect(missing[0]!.suggestion).toMatch(/dashboard \/ MCP plant/i);
    expect(missing[0]!.suggestion).not.toMatch(/ask_canary_/);
    expect(missing[0]!.message).not.toMatch(/ask_canary_/);
    expect(leakFindings.length).toBeGreaterThanOrEqual(1);
  });

  it('does not emit missing when ASSURLY_CANARY_URL is planted', () => {
    const example = `${ASSURLY_CANARY_ENV_KEY}=`;
    const result = scanEnvVariables(example, 'const x = 1;', '.env.example', 'code.ts');
    expect(result.findings.some((f) => f.ruleId === 'assurly-canary-missing')).toBe(false);
    expect(result.findings.some((f) => f.ruleId === 'assurly-canary-planted')).toBe(true);
  });

  it('treats ASSURLY_CANARY_URL callback lines as planted, not leaks', () => {
    const example = [
      `${ASSURLY_CANARY_ENV_KEY}=${CALLBACK}`,
      `STRIPE_SECRET_KEY=${FAKE_STRIPE_LIVE_LEAK}`,
    ].join('\n');

    const result = scanEnvVariables(example, 'const x = 1;', '.env.example', 'code.ts');
    const canaryFindings = result.findings.filter((f) => f.ruleId === 'assurly-canary-planted');
    const leakFindings = result.findings.filter((f) => f.ruleId === 'stripe-secret-leak');

    expect(canaryFindings).toHaveLength(1);
    expect(canaryFindings[0]!.severity).toBe('warning');
    expect(
      result.findings.some(
        (f) => f.severity === 'error' && f.message.includes(ASSURLY_CANARY_ENV_KEY),
      ),
    ).toBe(false);
    expect(leakFindings.length).toBeGreaterThanOrEqual(1);
  });
});

describe('mergeCanaryPlantIntoEnvExample', () => {
  const snippet = `${ASSURLY_CANARY_ENV_KEY}=${CALLBACK}`;

  it('appends the snippet when the key is missing', () => {
    const merged = mergeCanaryPlantIntoEnvExample('DATABASE_URL=\n', snippet);
    expect(merged.changed).toBe(true);
    expect(merged.content).toContain(snippet);
    expect(merged.content).toContain('DATABASE_URL=');
  });

  it('is idempotent when ASSURLY_CANARY_URL is already planted', () => {
    const existing = `DATABASE_URL=\n${snippet}\n`;
    const merged = mergeCanaryPlantIntoEnvExample(existing, snippet);
    expect(merged.changed).toBe(false);
    expect(merged.content).toBe(existing);
  });
});

describe('isAssurlyCanaryMcpUrl', () => {
  it('recognises the public callback as a decoy MCP endpoint', () => {
    expect(isAssurlyCanaryMcpUrl(CALLBACK)).toBe(true);
    expect(isAssurlyCanaryMcpUrl('https://mcp.example.com/sse')).toBe(false);
  });
});
