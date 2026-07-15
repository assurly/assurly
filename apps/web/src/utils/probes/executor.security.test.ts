import { describe, expect, it, vi } from 'vitest';
import { executeProbePlan, sanitizeProbePlan } from './executor';
import type { ProbeExecutionContext, ProbePlanStep } from './types';

/**
 * Security rails for the AI → executor boundary.
 *
 * Whatever the planner (or a hallucinating LLM) returns — including adversarial
 * JSON with mutating methods, raw URLs, or unknown primitives — must never
 * become a mutating or out-of-scope request. The executor + zod whitelist are
 * the hard rails; this file proves they hold with callClaude fully mocked out.
 */

function makeJwt(): string {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify({ role: 'anon' })).toString('base64url');
  return `${header}.${body}.sig`;
}

const SUPABASE_URL = 'https://demo.supabase.co';
const ANON_KEY = makeJwt();

function baseCtx(fetchImpl: typeof fetch): ProbeExecutionContext {
  return {
    targetOrigin: 'https://myapp.example',
    supabaseUrl: SUPABASE_URL,
    anonKey: ANON_KEY,
    fetchImpl,
    lookupImpl: async () => [{ address: '203.0.113.10', family: 4 }],
    // Tests inject a thin safeFetch that still goes through the provided fetchImpl
    // without DNS — production always uses runtimeScanner.safeFetch.
    safeFetch: async (rawUrl, init, impl = fetchImpl) => {
      const response = await (impl ?? fetchImpl)(rawUrl, {
        ...init,
        method: init?.method ?? 'GET',
      });
      return { response, finalUrl: new URL(rawUrl) };
    },
  };
}

describe('probe executor security rails', () => {
  it('sanitizeProbePlan drops unknown primitives and bad tables; strips adversarial extra keys', () => {
    const adversarial = [
      { primitive: 'http_raw', params: { method: 'DELETE', url: 'https://evil.example' } },
      { primitive: 'supabase_rls_table_read', params: { table: '../etc/passwd', method: 'POST' } },
      {
        primitive: 'supabase_rls_table_read',
        params: { table: 'users', url: 'https://attacker.example', method: 'PUT' },
      },
      { primitive: 'supabase_rls_table_read', params: { table: 'orders' } },
      { primitive: 'supabase_rls_table_read', params: { table: 'orders' } }, // dup
      'not-an-object',
      null,
      { primitive: 'supabase_rls_table_read', params: { table: 'a; DROP TABLE users;--' } },
    ];

    const plan = sanitizeProbePlan(adversarial);
    expect(plan).toEqual([
      { primitive: 'supabase_rls_table_read', params: { table: 'users' } },
      { primitive: 'supabase_rls_table_read', params: { table: 'orders' } },
    ]);
  });

  it('executeProbePlan NEVER issues POST/PUT/PATCH/DELETE even when the plan is adversarial', async () => {
    const methods: string[] = [];
    const urls: string[] = [];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      methods.push((init?.method ?? 'GET').toUpperCase());
      urls.push(String(input));
      return new Response(JSON.stringify([]), { status: 200 });
    }) as unknown as typeof fetch;

    const adversarialPlan = [
      { primitive: 'http_raw', params: { method: 'DELETE', url: 'https://evil.example/x' } },
      {
        primitive: 'supabase_rls_table_read',
        params: { table: 'users', method: 'POST', body: '{"a":1}' },
      },
      { primitive: 'shell_exec', params: { cmd: 'rm -rf /' } },
      { primitive: 'supabase_rls_table_read', params: { table: 'profiles' } },
    ] as unknown as ProbePlanStep[];

    // Pre-sanitize as the planner path does — then also run a raw adversarial
    // list through sanitize to prove the same rails.
    const plan = sanitizeProbePlan(adversarialPlan);
    await executeProbePlan(plan, baseCtx(fetchImpl));

    expect(methods.length).toBeGreaterThan(0);
    expect(methods.every((m) => m === 'GET')).toBe(true);
    expect(urls.every((u) => u.startsWith(`${SUPABASE_URL}/rest/v1/`))).toBe(true);
    expect(urls.some((u) => u.includes('evil.example'))).toBe(false);
  });

  it('executeProbePlan ignores unknown primitive names even if passed unsanitized', async () => {
    const fetchImpl = vi.fn(
      async () => new Response(JSON.stringify([]), { status: 200 }),
    ) as unknown as typeof fetch;

    const result = await executeProbePlan(
      [
        { primitive: 'http_raw' as 'supabase_rls_table_read', params: { method: 'DELETE' } },
        { primitive: 'supabase_rls_table_read', params: { table: '!!!' } },
      ],
      baseCtx(fetchImpl),
    );

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(result.executed).toBe(0);
    expect(result.skipped).toBe(2);
  });

  it('never fetches an out-of-scope host — supabaseUrl comes from context, not params', async () => {
    const urls: string[] = [];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      urls.push(String(input));
      return new Response(JSON.stringify([]), { status: 200 });
    }) as unknown as typeof fetch;

    const plan = sanitizeProbePlan([
      {
        primitive: 'supabase_rls_table_read',
        params: {
          table: 'users',
          supabaseUrl: 'https://evil-supabase.example',
          anonKey: 'forged',
        },
      },
    ]);

    await executeProbePlan(plan, baseCtx(fetchImpl));

    expect(plan).toEqual([{ primitive: 'supabase_rls_table_read', params: { table: 'users' } }]);
    expect(urls.every((u) => u.startsWith(SUPABASE_URL))).toBe(true);
    expect(urls.some((u) => u.includes('evil-supabase'))).toBe(false);
  });
});
