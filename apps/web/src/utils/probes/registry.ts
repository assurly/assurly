import { z } from 'zod';
import { executeSupabaseRlsTableRead } from './supabaseRls';
import {
  PROBE_PRIMITIVE_NAMES,
  supabaseRlsTableReadParamsSchema,
  type ProbeExecutionContext,
  type ProbePrimitiveName,
  type ProbeStepResult,
} from './types';

export type ProbeHandler = (
  params: Record<string, unknown>,
  ctx: ProbeExecutionContext,
) => Promise<ProbeStepResult>;

interface ProbePrimitiveDefinition {
  name: ProbePrimitiveName;
  /** Zod schema for planner-supplied params. Extra keys are rejected. */
  paramsSchema: z.ZodTypeAny;
  execute: ProbeHandler;
}

/**
 * The whitelist. If a name is not here, the executor will never run it —
 * regardless of what the LLM emits.
 */
export const PROBE_REGISTRY: Readonly<Record<ProbePrimitiveName, ProbePrimitiveDefinition>> = {
  supabase_rls_table_read: {
    name: 'supabase_rls_table_read',
    paramsSchema: supabaseRlsTableReadParamsSchema,
    execute: async (params, ctx) => {
      const parsed = supabaseRlsTableReadParamsSchema.parse(params);
      return executeSupabaseRlsTableRead(parsed, ctx);
    },
  },
};

export function isProbePrimitiveName(value: unknown): value is ProbePrimitiveName {
  return typeof value === 'string' && (PROBE_PRIMITIVE_NAMES as readonly string[]).includes(value);
}

/** Human-readable list for the planner system prompt. */
export function describeWhitelistedPrimitives(): string {
  return PROBE_PRIMITIVE_NAMES.map((name) => {
    switch (name) {
      case 'supabase_rls_table_read':
        return `${name}: read one Supabase table via the anon key (params: { table: string })`;
      default: {
        const exhaustive: never = name;
        return exhaustive;
      }
    }
  }).join('\n');
}
