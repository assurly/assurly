import { z } from 'zod';
import type { WebFinding } from '../browserScanner';

/**
 * Whitelisted probe primitive names. The LLM may select among these only —
 * never invent new names, never emit raw HTTP. Adding a primitive requires a
 * code change here + a registry entry with a zod schema and a safe executor.
 */
export const PROBE_PRIMITIVE_NAMES = ['supabase_rls_table_read'] as const;

export type ProbePrimitiveName = (typeof PROBE_PRIMITIVE_NAMES)[number];

/** Postgres-ish identifier: letters, digits, underscore; no path separators. */
export const TABLE_NAME_SCHEMA = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z_][A-Za-z0-9_]*$/, 'Table name must be a plain identifier');

export const supabaseRlsTableReadParamsSchema = z
  .object({
    table: TABLE_NAME_SCHEMA,
  })
  .strip(); // drop unknown keys (method, url, …) — never forward them to the handler

export type SupabaseRlsTableReadParams = z.infer<typeof supabaseRlsTableReadParamsSchema>;

/**
 * One planner step. `params` are validated against the primitive's schema before
 * execution — unknown keys are stripped; only schema fields reach the handler.
 */
export interface ProbePlanStep {
  primitive: ProbePrimitiveName;
  params: Record<string, unknown>;
}

/** Injectable DNS lookup (mirrors runtimeScanner; kept local to avoid cycles). */
export type ProbeLookupImpl = (
  hostname: string,
) => Promise<Array<{ address: string; family: number }>>;

/** SSRF-safe fetch signature — injected by the scanner (never supplied by the LLM). */
export type ProbeSafeFetch = (
  rawUrl: string,
  init?: RequestInit,
  fetchImpl?: typeof fetch,
  lookupImpl?: ProbeLookupImpl,
) => Promise<{ response: Response; finalUrl: URL }>;

/**
 * Host/credentials the executor already trusts — never taken from the LLM.
 * `supabaseUrl` / `anonKey` come from the scanned page (SSRF-checked at fetch time).
 */
export interface ProbeExecutionContext {
  /** Origin of the scanned app (ownership-gated caller). */
  targetOrigin: string;
  supabaseUrl?: string;
  anonKey?: string;
  fetchImpl: typeof fetch;
  lookupImpl?: ProbeLookupImpl;
  /** The scanner's SSRF-safe fetch — hard rail independent of the LLM. */
  safeFetch: ProbeSafeFetch;
  /** Soft wall-clock budget for the whole plan (default 30s). */
  maxDurationMs?: number;
  /** Soft cap on steps executed (default 12). */
  maxSteps?: number;
}

/** Local evidence shape (matches runtimeScanner.ProbeEvidence). */
export interface ProbeStepEvidence {
  findingRuleId: string;
  kind: 'rls_rows' | 'exposed_secret' | 'open_endpoint' | 'missing_header';
  summary: string;
  redactedSample?: {
    rowCount?: number;
    columns?: string[];
    sampleCell?: string;
    table?: string;
    secretLabel?: string;
    maskedSecret?: string;
    headers?: string[];
  };
}

export interface ProbeStepResult {
  findings: WebFinding[];
  evidence: ProbeStepEvidence[];
  /** Table that returned rows (for write-implied follow-up). */
  openTable?: string;
}

export interface ProbePlanResult {
  findings: WebFinding[];
  evidence: ProbeStepEvidence[];
  /** Steps that were skipped because validation failed or budget ran out. */
  skipped: number;
  /** Steps that ran successfully (including "no rows" outcomes). */
  executed: number;
}
