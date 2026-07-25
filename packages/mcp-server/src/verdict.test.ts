import { describe, expect, it, vi } from 'vitest';
import { formatFixOutcomesText, handleVerdict, type VerdictToolConfig } from './tools';

const API_URL = 'https://assurly.dev';
const API_KEY = 'ask_live_dummydummydummydummydummydummy';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function textBlocks(result: { content: Array<{ type: string; text?: string }> }): string {
  return result.content
    .filter((block) => block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text as string)
    .join('\n');
}

function config(fetchImpl: VerdictToolConfig['fetchImpl'], apiKey = API_KEY): VerdictToolConfig {
  return { apiUrl: API_URL, apiKey, fetchImpl };
}

describe('formatFixOutcomesText', () => {
  it('states observation time and refuses to treat still_open as a live failure', () => {
    const text = formatFixOutcomesText([
      {
        ruleId: 'runtime-supabase-rls-open',
        outcome: 'still_open',
        observedAt: '2026-07-18T06:00:00.000Z',
      },
    ]);
    expect(text).toContain('runtime-supabase-rls-open: still_open');
    expect(text).toContain('observed 2026-07-18T06:00:00.000Z');
    expect(text).toMatch(/last re-probe only/i);
    expect(text).toMatch(/Not yet verified/i);
    expect(text).toMatch(/deploy and re-probe/i);
    // Must not claim the agent's current edit failed — that would be the same
    // class of lie this feature exists to prevent, pointed the other way.
    expect(text).not.toMatch(/your fix failed/i);
    expect(text).not.toMatch(/still open — fix failed/i);
  });

  it('guides re-probe when no outcomes exist yet', () => {
    const text = formatFixOutcomesText([]);
    expect(text).toMatch(/none recorded yet/i);
    expect(text).toMatch(/re-probe/i);
  });
});

describe('assurly_verdict MCP tool (reads the hosted API)', () => {
  it('returns a structured verdict for a known target and calls only the hosted API', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({
        status: 'blocked',
        shipScore: 80,
        displayName: 'Example app',
        identifier: 'https://app.example.com',
        kind: 'url',
        topIssue: {
          category: 'Database access control (RLS)',
          severity: 'error',
          remediation: 'Enable Row-Level Security on every Supabase table.',
        },
        trustPageUrl: 'https://assurly.dev/report/abc',
        activeProbeAllowed: true,
        fixOutcomes: [],
      }),
    );

    const result = await handleVerdict({ url: 'https://app.example.com' }, config(fetchImpl));
    const output = textBlocks(result);

    expect(output).toContain('BLOCKED');
    expect(output).toContain('80/100');
    expect(output).toContain('Database access control (RLS)');
    expect(output).toContain('Enable Row-Level Security');
    expect(output).toContain('https://assurly.dev/report/abc');
    expect(output).toContain('Fix outcomes: none recorded yet');
    expect(result.isError).toBe(true); // a blocked verdict is a real ship-gate failure

    // It READS the hosted API — exactly one GET, with the bearer key, and no local scan.
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [calledUrl, init] = fetchImpl.mock.calls[0];
    expect(calledUrl).toBe(
      `${API_URL}/api/v1/verdict?url=${encodeURIComponent('https://app.example.com')}`,
    );
    expect(init?.method).toBe('GET');
    expect((init?.headers as Record<string, string>).Authorization).toBe(`Bearer ${API_KEY}`);
  });

  it('surfaces all three fix outcomes in text and JSON with observation times', async () => {
    const payload = {
      status: 'review',
      shipScore: 70,
      displayName: 'Example app',
      identifier: 'https://app.example.com',
      kind: 'url',
      topIssue: null,
      activeProbeAllowed: true,
      fixOutcomes: [
        {
          ruleId: 'runtime-supabase-rls-open',
          outcome: 'verified_fixed',
          observedAt: '2026-07-18T10:00:00.000Z',
        },
        {
          ruleId: 'runtime-secret-in-bundle',
          outcome: 'still_open',
          observedAt: '2026-07-18T09:00:00.000Z',
        },
        {
          ruleId: 'runtime-missing-security-headers',
          outcome: 'regressed',
          observedAt: '2026-07-18T08:00:00.000Z',
        },
      ],
    };
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(payload));
    const result = await handleVerdict({ url: 'https://app.example.com' }, config(fetchImpl));
    const output = textBlocks(result);

    expect(output).toContain(
      'runtime-supabase-rls-open: verified_fixed · observed 2026-07-18T10:00:00.000Z',
    );
    expect(output).toContain(
      'runtime-secret-in-bundle: still_open · observed 2026-07-18T09:00:00.000Z',
    );
    expect(output).toContain(
      'runtime-missing-security-headers: regressed · observed 2026-07-18T08:00:00.000Z',
    );
    expect(output).toMatch(/Not yet verified/i);
    // JSON payload carries the same shape-only outcomes for programmatic agents.
    expect(output).toContain('"outcome": "verified_fixed"');
    expect(output).toContain('"observedAt": "2026-07-18T09:00:00.000Z"');
    // still_open / regressed must NOT widen isError — status is review, not blocked.
    expect(result.isError).toBe(false);
  });

  it('treats a stale still_open observation as not-yet-verified, not as isError', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({
        status: 'ready',
        shipScore: 100,
        displayName: 'Example app',
        identifier: 'https://app.example.com',
        kind: 'url',
        topIssue: null,
        activeProbeAllowed: true,
        // Observation predates any claim the agent is asking about — age must be
        // unmistakable, and must not halt the agent as a failed claim.
        fixOutcomes: [
          {
            ruleId: 'runtime-supabase-rls-open',
            outcome: 'still_open',
            observedAt: '2026-07-01T00:00:00.000Z',
          },
        ],
      }),
    );

    const result = await handleVerdict({ url: 'https://app.example.com' }, config(fetchImpl));
    const output = textBlocks(result);

    expect(output).toContain('READY');
    expect(output).toContain('observed 2026-07-01T00:00:00.000Z');
    expect(output).toMatch(/Not yet verified/i);
    expect(output).toMatch(/deploy and re-probe/i);
    expect(result.isError).toBe(false);
  });

  it('returns the PASSIVE verdict for a stranger URL and triggers NO active probe', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({
        status: 'unknown',
        shipScore: null,
        identifier: 'https://stranger.example.com',
        kind: 'url',
        topIssue: null,
        activeProbeAllowed: false,
        fixOutcomes: [],
      }),
    );

    const result = await handleVerdict({ url: 'https://stranger.example.com' }, config(fetchImpl));
    const output = textBlocks(result);

    expect(output).toContain('UNKNOWN');
    expect(result.isError).toBe(false);
    // The only network call is the single hosted-API read — never a probe.
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0][1]?.method).toBe('GET');
  });

  it('errors without an API key and never calls the network', async () => {
    const fetchImpl = vi.fn();
    const result = await handleVerdict(
      { url: 'https://app.example.com' },
      { apiUrl: API_URL, apiKey: undefined, fetchImpl },
    );
    expect(result.isError).toBe(true);
    expect(textBlocks(result)).toContain('ASSURLY_API_KEY');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('rejects providing both url and repo', async () => {
    const fetchImpl = vi.fn();
    const result = await handleVerdict(
      { url: 'https://app.example.com', repo: 'acme/api' },
      config(fetchImpl),
    );
    expect(result.isError).toBe(true);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('surfaces an invalid/revoked key (401) as an error', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(null, { status: 401 }));
    const result = await handleVerdict({ repo: 'acme/api' }, config(fetchImpl));
    expect(result.isError).toBe(true);
    expect(textBlocks(result)).toMatch(/invalid or revoked/i);
  });
});
