import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { getApplicationUrl, isTrustedDevOrigin } from '../../../utils/env';
import { createConnectorServer } from '../../../utils/mcp/connectorServer';
import { allowMcpRequest, allowScan } from '../../../utils/mcp/limits';
import { getClientIp } from '../../../utils/rateLimit';
import { scanLiveUrlWithEvidence } from '../../../utils/runtimeScanner';

/**
 * Public MCP endpoint for the Claude Connectors Directory (Streamable HTTP,
 * stateless, JSON responses). Anonymous by design: it exposes only the passive
 * live-app check, and every scan is bounded by the budgets in utils/mcp/limits.
 *
 * Not built on secureRoute: its per-IP limit would put every Claude user into
 * one bucket (they share Anthropic's egress addresses), and MCP clients need
 * JSON-RPC error bodies, not the API error envelope.
 */

// One scan reads the page and up to 24 scripts under an 8s + 10s budget.
export const maxDuration = 60;

const MAX_BODY_BYTES = 16 * 1024;
const CLAUDE_ORIGINS = new Set(['https://claude.ai', 'https://claude.com']);
const NO_STORE = { 'Cache-Control': 'no-store' };

function jsonRpcError(
  status: number,
  code: number,
  message: string,
  headers: Record<string, string> = {},
): Response {
  return Response.json(
    { jsonrpc: '2.0', error: { code, message }, id: null },
    { status, headers: { ...NO_STORE, ...headers } },
  );
}

/**
 * Claude calls from its servers and sends no Origin. A browser always does, so
 * a foreign Origin means some web page is trying to spend our scan budget from
 * its visitors' addresses. The MCP spec also requires validating Origin.
 */
function isAllowedOrigin(origin: string | null): boolean {
  if (origin === null || CLAUDE_ORIGINS.has(origin)) return true;
  try {
    if (new URL(getApplicationUrl()).origin === origin) return true;
  } catch {
    // APP_URL missing: only Claude's origins and server-side callers are allowed.
  }
  return process.env.NODE_ENV !== 'production' && isTrustedDevOrigin(origin);
}

/** Reads at most `limit` bytes, so a chunked upload cannot grow unbounded in memory. */
async function readBodyText(request: Request, limit: number): Promise<string | null> {
  const declared = Number(request.headers.get('content-length') ?? 0);
  if (Number.isFinite(declared) && declared > limit) return null;
  if (!request.body) return '';

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

export async function POST(request: Request): Promise<Response> {
  const origin = request.headers.get('origin');
  if (!isAllowedOrigin(origin)) {
    console.warn(JSON.stringify({ service: 'assurly-mcp', outcome: 'refused:origin', origin }));
    return jsonRpcError(403, -32000, 'Origin not allowed.');
  }

  const clientIp = getClientIp(request);
  const allowance = await allowMcpRequest(clientIp);
  if (!allowance.allowed) {
    return jsonRpcError(429, -32000, 'Too many requests. Try again shortly.', {
      'Retry-After': String(allowance.retryAfterSeconds),
    });
  }

  const text = await readBodyText(request, MAX_BODY_BYTES);
  if (text === null) return jsonRpcError(413, -32600, 'Request body is too large.');

  let parsedBody: unknown;
  try {
    parsedBody = JSON.parse(text);
  } catch {
    return jsonRpcError(400, -32700, 'Parse error: the body must be one JSON-RPC message.');
  }
  // Batching was removed from MCP in 2025-06-18; one message per request also
  // keeps a single HTTP request from starting many scans.
  if (Array.isArray(parsedBody)) {
    return jsonRpcError(400, -32600, 'Batch requests are not supported.');
  }

  const server = createConnectorServer({
    clientIp,
    scan: scanLiveUrlWithEvidence,
    allowScan,
    now: () => new Date(),
  });
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });

  try {
    await server.connect(transport);
    const response = await transport.handleRequest(request, { parsedBody });
    response.headers.set('Cache-Control', 'no-store');
    return response;
  } catch (error) {
    console.error(
      JSON.stringify({
        service: 'assurly-mcp',
        outcome: 'internal_error',
        errorType: error instanceof Error ? error.name : 'UnknownError',
        errorMessage: error instanceof Error ? error.message : String(error),
      }),
    );
    return jsonRpcError(500, -32603, 'Internal error.');
  } finally {
    await server.close();
  }
}

/** Stateless server: no SSE stream to open and no session to delete. */
function methodNotAllowed(): Response {
  return jsonRpcError(405, -32000, 'Method not allowed. Send MCP messages with POST.', {
    Allow: 'POST',
  });
}

export async function GET(): Promise<Response> {
  return methodNotAllowed();
}

export async function DELETE(): Promise<Response> {
  return methodNotAllowed();
}
