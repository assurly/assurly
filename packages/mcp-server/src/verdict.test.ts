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

describe('assurly_verdict MCP tool (Live Lock)', () => {
  it('POSTs a fresh Live Lock check and treats BLOCKED as a ship failure', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({
        status: 'blocked',
        shipScore: 59,
        reason: 'runtime_blocker',
        gitSha: 'abc1234',
        attemptId: 'mcp-abc1234',
        checkedAt: '2026-10-23T12:00:00.000Z',
      }),
    );

    const result = await handleVerdict(
      { url: 'https://app.example.com', gitSha: 'ABC1234' },
      config(fetchImpl),
    );
    const output = textBlocks(result);

    expect(output).toContain('BLOCKED');
    expect(output).toContain('59/100');
    expect(output).toContain('runtime_blocker');
    expect(result.isError).toBe(true);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [calledUrl, init] = fetchImpl.mock.calls[0];
    expect(calledUrl).toBe(`${API_URL}/api/v1/live-lock`);
    expect(init?.method).toBe('POST');
    expect(JSON.parse(String(init?.body))).toEqual({
      url: 'https://app.example.com',
      gitSha: 'abc1234',
      attemptId: 'mcp-abc1234',
    });
    expect((init?.headers as Record<string, string>).Authorization).toBe(`Bearer ${API_KEY}`);
  });

  it('returns READY only from the fresh check payload', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({
        status: 'ready',
        shipScore: 100,
        reason: 'clear',
        gitSha: 'abc1234',
        attemptId: 'deploy-9',
        checkedAt: '2026-10-23T12:00:00.000Z',
      }),
    );
    const result = await handleVerdict(
      { url: 'https://app.example.com', gitSha: 'abc1234', attemptId: 'deploy-9' },
      config(fetchImpl),
    );
    expect(textBlocks(result)).toContain('READY');
    expect(result.isError).toBe(false);
    expect(JSON.parse(String(fetchImpl.mock.calls[0][1]?.body)).attemptId).toBe('deploy-9');
  });

  it('refuses to call the API without a url and git SHA', async () => {
    const fetchImpl = vi.fn();
    const result = await handleVerdict({ url: 'https://app.example.com' }, config(fetchImpl));
    expect(result.isError).toBe(true);
    expect(textBlocks(result)).toMatch(/gitSha/i);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('errors without an API key and never calls the network', async () => {
    const fetchImpl = vi.fn();
    const result = await handleVerdict(
      { url: 'https://app.example.com', gitSha: 'abc1234' },
      { apiUrl: API_URL, apiKey: undefined, fetchImpl },
    );
    expect(result.isError).toBe(true);
    expect(textBlocks(result)).toContain('ASSURLY_API_KEY');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('surfaces an invalid/revoked key (401) as an error', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(null, { status: 401 }));
    const result = await handleVerdict(
      { url: 'https://app.example.com', gitSha: 'abc1234' },
      config(fetchImpl),
    );
    expect(result.isError).toBe(true);
    expect(textBlocks(result)).toMatch(/invalid or revoked/i);
  });
});
