import { beforeEach, describe, expect, it } from 'vitest';
import { resetRateLimitsForTests } from '../rateLimit';
import {
  allowMcpRequest,
  allowScan,
  isAnthropicEgressAddress,
  MCP_LIMITS,
  targetKey,
} from './limits';

const CLAUDE_IP = '160.79.106.12';
const PERSON_IP = '203.0.113.7';

async function exhaust(times: number, run: () => Promise<{ allowed: boolean }>): Promise<void> {
  for (let i = 0; i < times; i += 1) {
    const result = await run();
    expect(result.allowed).toBe(true);
  }
}

describe('isAnthropicEgressAddress', () => {
  it('matches the whole published 160.79.104.0/21 range and nothing next to it', () => {
    expect(isAnthropicEgressAddress('160.79.104.0')).toBe(true);
    expect(isAnthropicEgressAddress('160.79.111.255')).toBe(true);
    expect(isAnthropicEgressAddress('160.79.103.255')).toBe(false);
    expect(isAnthropicEgressAddress('160.79.112.0')).toBe(false);
    expect(isAnthropicEgressAddress('unknown')).toBe(false);
    expect(isAnthropicEgressAddress('2001:db8::1')).toBe(false);
  });
});

describe('targetKey', () => {
  it('treats www., letter case and a trailing dot as the same site', () => {
    expect(targetKey('WWW.Example.com.')).toBe('example.com');
    expect(targetKey('app.example.com')).toBe('app.example.com');
  });
});

describe('allowScan', () => {
  beforeEach(() => resetRateLimitsForTests());

  it('limits one address outside Anthropic’s range like the website scan route', async () => {
    await exhaust(MCP_LIMITS.scansPerClient.limit, () =>
      allowScan(PERSON_IP, `site-${Math.random()}.example.com`),
    );
    const refused = await allowScan(PERSON_IP, 'another.example.com');
    expect(refused).toMatchObject({ allowed: false, reason: 'client' });
  });

  it('does not let Claude users share one per-address bucket', async () => {
    await exhaust(MCP_LIMITS.scansPerClient.limit + 3, () =>
      allowScan(CLAUDE_IP, `site-${Math.random()}.example.com`),
    );
  });

  it('caps scans of one site across every caller', async () => {
    await exhaust(MCP_LIMITS.scansPerTarget.limit, () =>
      allowScan(CLAUDE_IP, 'victim.example.com'),
    );
    const refused = await allowScan(CLAUDE_IP, 'www.victim.example.com');
    expect(refused).toMatchObject({ allowed: false, reason: 'target' });
    expect(refused.allowed === false && refused.retryAfterSeconds).toBeGreaterThan(0);
  });

  it('stops at the global per-minute budget', async () => {
    await exhaust(MCP_LIMITS.scansPerMinute.limit, () =>
      allowScan(CLAUDE_IP, `site-${Math.random()}.example.com`),
    );
    const refused = await allowScan(CLAUDE_IP, 'late.example.com');
    expect(refused).toMatchObject({ allowed: false, reason: 'capacity' });
  });
});

describe('allowMcpRequest', () => {
  beforeEach(() => resetRateLimitsForTests());

  it('limits a single address outside Anthropic’s range', async () => {
    await exhaust(MCP_LIMITS.requestsPerClient.limit, () => allowMcpRequest(PERSON_IP));
    expect((await allowMcpRequest(PERSON_IP)).allowed).toBe(false);
  });

  it('never limits Claude’s shared addresses per address', async () => {
    await exhaust(MCP_LIMITS.requestsPerClient.limit + 5, () => allowMcpRequest(CLAUDE_IP));
  });
});
