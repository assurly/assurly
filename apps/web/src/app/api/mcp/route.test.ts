import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MCP_LIMITS } from '../../../utils/mcp/limits';
import { resetRateLimitsForTests } from '../../../utils/rateLimit';
import { DELETE, GET, POST } from './route';

const scanMock = vi.hoisted(() => vi.fn());

vi.mock('../../../utils/runtimeScanner', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../utils/runtimeScanner')>();
  return { ...actual, scanLiveUrlWithEvidence: scanMock };
});

const CLAUDE_IP = '160.79.104.20';
const PERSON_IP = '198.51.100.23';

function mcpRequest(
  body: unknown,
  init: { headers?: Record<string, string>; rawBody?: string } = {},
): Request {
  return new Request('https://assurly.dev/api/mcp', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      'x-forwarded-for': CLAUDE_IP,
      ...init.headers,
    },
    body: init.rawBody ?? JSON.stringify(body),
  });
}

function rpc(method: string, params: Record<string, unknown> = {}, id = 1) {
  return { jsonrpc: '2.0', id, method, params };
}

const INITIALIZE = rpc('initialize', {
  protocolVersion: '2025-06-18',
  capabilities: {},
  clientInfo: { name: 'test-client', version: '1.0.0' },
});

async function callCheck(args: Record<string, unknown>) {
  const response = await POST(
    mcpRequest(rpc('tools/call', { name: 'check_live_app', arguments: args })),
  );
  return { response, json: await response.json() };
}

describe('/api/mcp', () => {
  beforeEach(() => {
    resetRateLimitsForTests();
    scanMock.mockReset();
    scanMock.mockResolvedValue({ findings: [], evidence: [], pageText: '' });
    vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.stubEnv('APP_URL', 'https://assurly.dev');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it('completes the initialize handshake', async () => {
    const response = await POST(mcpRequest(INITIALIZE));
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const json = await response.json();
    expect(json.result.serverInfo).toMatchObject({ name: 'assurly', title: 'Assurly' });
    expect(json.result.capabilities.tools).toBeDefined();
  });

  it('lists exactly one read-only tool with a title and annotations', async () => {
    const response = await POST(mcpRequest(rpc('tools/list')));
    const { result } = await response.json();

    expect(result.tools).toHaveLength(1);
    const [tool] = result.tools;
    expect(tool.name).toBe('check_live_app');
    expect(tool.name.length).toBeLessThanOrEqual(64);
    expect(tool.title).toBe('Check a live app');
    expect(tool.annotations).toMatchObject({
      title: 'Check a live app',
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: true,
    });
    expect(tool.inputSchema.additionalProperties).toBe(false);
    expect(tool.outputSchema.properties.verdict).toBeDefined();
  });

  it('runs a passive check and returns structured and text results', async () => {
    const { response, json } = await callCheck({ url: 'https://my-app.lovable.app' });

    expect(response.status).toBe(200);
    expect(json.result.isError).toBeFalsy();
    expect(json.result.structuredContent).toMatchObject({
      verdict: 'ready',
      url: 'https://my-app.lovable.app/',
    });
    expect(json.result.content[0].text).toContain('Ready to ship');
    expect(scanMock).toHaveBeenCalledWith(
      'https://my-app.lovable.app/',
      expect.any(Function),
      undefined,
      {
        activeProbe: false,
        visibilityAudit: false,
        useAiPlanner: false,
      },
    );
  });

  it('rejects arguments beyond the schema instead of passing them to the scanner', async () => {
    const { json } = await callCheck({ url: 'https://my-app.lovable.app', activeProbe: true });

    const failed = json.error !== undefined || json.result?.isError === true;
    expect(failed).toBe(true);
    expect(scanMock).not.toHaveBeenCalled();
  });

  it('refuses a private address with an actionable tool error', async () => {
    const { json } = await callCheck({ url: 'http://10.0.0.5/admin' });
    expect(json.result.isError).toBe(true);
    expect(json.result.content[0].text).toContain('public URL');
    expect(scanMock).not.toHaveBeenCalled();
  });

  it('allows Claude’s origin and server-side callers, refuses other browser origins', async () => {
    const fromClaude = await POST(
      mcpRequest(INITIALIZE, { headers: { origin: 'https://claude.ai' } }),
    );
    expect(fromClaude.status).toBe(200);

    const fromPage = await POST(
      mcpRequest(INITIALIZE, { headers: { origin: 'https://evil.example' } }),
    );
    expect(fromPage.status).toBe(403);
  });

  it('limits one address outside Anthropic’s range', async () => {
    const headers = { 'x-forwarded-for': PERSON_IP };
    for (let i = 0; i < MCP_LIMITS.requestsPerClient.limit; i += 1) {
      const ok = await POST(mcpRequest(rpc('tools/list', {}, i), { headers }));
      expect(ok.status).toBe(200);
    }
    const limited = await POST(mcpRequest(rpc('tools/list'), { headers }));
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get('retry-after'))).toBeGreaterThan(0);
  });

  it('refuses an oversized body', async () => {
    const response = await POST(
      mcpRequest(null, { rawBody: JSON.stringify(rpc('tools/list', { pad: 'x'.repeat(20_000) })) }),
    );
    expect(response.status).toBe(413);
  });

  it('refuses invalid JSON', async () => {
    const response = await POST(mcpRequest(null, { rawBody: '{not json' }));
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe(-32700);
  });

  it('refuses JSON-RPC batches so one request cannot start many scans', async () => {
    const batch = [1, 2, 3].map((id) =>
      rpc(
        'tools/call',
        { name: 'check_live_app', arguments: { url: `https://s${id}.example.com` } },
        id,
      ),
    );
    const response = await POST(mcpRequest(batch));
    expect(response.status).toBe(400);
    expect(scanMock).not.toHaveBeenCalled();
  });

  it('requires the Streamable HTTP Accept header', async () => {
    const response = await POST(
      mcpRequest(INITIALIZE, { headers: { accept: 'application/json' } }),
    );
    expect(response.status).toBe(406);
  });

  it.each([
    ['GET', GET],
    ['DELETE', DELETE],
  ])('answers %s with 405 because the server is stateless', async (_method, handler) => {
    const response = await handler();
    expect(response.status).toBe(405);
    expect(response.headers.get('allow')).toBe('POST');
  });
});
