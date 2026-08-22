import { describe, expect, it } from 'vitest';
import { ASSURLY_CANARY_ENV_KEY, ASSURLY_CANARY_PREFIX } from '@assurly/scanner-core';
import {
  CANARY_HIT_ROTATE_COPY,
  CANARY_SNIPPET_FORBIDDEN_KEYS,
  buildCanaryCallbackUrl,
  buildCanaryCopyPayload,
  buildCanaryMcpDecoySnippet,
  buildCanaryPlantSnippet,
  canarySnippetUsesSafeKey,
  resolveCanaryCallbackOrigin,
} from './canaryPlant';

const PLAINTEXT = `${ASSURLY_CANARY_PREFIX}${'a'.repeat(32)}`;

describe('canary plant snippet', () => {
  it('builds an HTTPS callback URL on the existing /api/canary path', () => {
    expect(buildCanaryCallbackUrl('https://assurly.dev/', PLAINTEXT)).toBe(
      `https://assurly.dev/api/canary/${encodeURIComponent(PLAINTEXT)}`,
    );
  });

  it('maps loopback APP_URL to the public Assurly origin', () => {
    expect(resolveCanaryCallbackOrigin('http://localhost:3000')).toBe('https://assurly.dev');
    expect(resolveCanaryCallbackOrigin('http://127.0.0.1:3200')).toBe('https://assurly.dev');
    expect(resolveCanaryCallbackOrigin('https://assurly.dev')).toBe('https://assurly.dev');
  });

  it('uses ASSURLY_CANARY_URL and never lookalike service keys', () => {
    const url = buildCanaryCallbackUrl('https://assurly.dev', PLAINTEXT);
    const snippet = buildCanaryPlantSnippet(url);
    const lines = snippet.split('\n');

    expect(lines).toHaveLength(3);
    expect(lines[2]).toBe(`${ASSURLY_CANARY_ENV_KEY}=${url}`);
    expect(snippet).toMatch(/tripwire/i);
    expect(canarySnippetUsesSafeKey(snippet)).toBe(true);
    for (const key of CANARY_SNIPPET_FORBIDDEN_KEYS) {
      expect(snippet).not.toContain(`${key}=`);
    }
  });

  it('tells operators to rotate real secrets, not the canary URL', () => {
    expect(CANARY_HIT_ROTATE_COPY).toMatch(/Stripe/);
    expect(CANARY_HIT_ROTATE_COPY).toMatch(/Supabase/);
    expect(CANARY_HIT_ROTATE_COPY).toMatch(/GitHub/);
    expect(CANARY_HIT_ROTATE_COPY).toMatch(/not the canary URL/i);
  });

  it('builds a decoy MCP snippet that must stay disabled', () => {
    const url = buildCanaryCallbackUrl('https://assurly.dev', PLAINTEXT);
    const mcp = buildCanaryMcpDecoySnippet(url);
    expect(mcp).toContain('assurly-cloud-auth');
    expect(mcp).toContain(url);
    expect(mcp).toMatch(/disabledMcpjsonServers/);
    expect(canarySnippetUsesSafeKey(mcp)).toBe(true);

    const copy = buildCanaryCopyPayload(buildCanaryPlantSnippet(url), mcp);
    expect(copy).toContain(`${ASSURLY_CANARY_ENV_KEY}=`);
    expect(copy).toContain('assurly-cloud-auth');
  });
});
