import { PROBE_MAX_DURATION_MS, PROBE_MAX_STEPS } from './defaults';
import { isProbePrimitiveName, PROBE_REGISTRY } from './registry';
import { buildAnonWriteImpliedFindings } from './supabaseRls';
import type {
  ProbeExecutionContext,
  ProbePlanResult,
  ProbePlanStep,
  ProbeStepEvidence,
} from './types';
import type { WebFinding } from '../browserScanner';
import { UrlSafetyError } from '../urlSafety';

/**
 * Parses and sanitises a raw planner payload into a bounded list of whitelist
 * steps. Unknown primitives, invalid params, and non-objects are dropped —
 * never executed. This is the first hard rail (schema), independent of the LLM.
 */
export function sanitizeProbePlan(
  raw: unknown,
  maxSteps: number = PROBE_MAX_STEPS,
): ProbePlanStep[] {
  if (!Array.isArray(raw)) return [];

  const steps: ProbePlanStep[] = [];
  const seen = new Set<string>();

  for (const item of raw) {
    if (steps.length >= maxSteps) break;
    if (!item || typeof item !== 'object') continue;

    const record = item as Record<string, unknown>;
    if (!isProbePrimitiveName(record.primitive)) continue;

    const params =
      record.params && typeof record.params === 'object' && !Array.isArray(record.params)
        ? (record.params as Record<string, unknown>)
        : {};

    const definition = PROBE_REGISTRY[record.primitive];
    const parsed = definition.paramsSchema.safeParse(params);
    if (!parsed.success) continue;

    // Deduplicate identical steps (same primitive + serialised params).
    const key = `${record.primitive}:${JSON.stringify(parsed.data)}`;
    if (seen.has(key)) continue;
    seen.add(key);

    steps.push({ primitive: record.primitive, params: parsed.data });
  }

  return steps;
}

function isHardSafetyError(error: unknown): boolean {
  if (error instanceof UrlSafetyError) return true;
  if (!(error instanceof Error)) return false;
  const message = error.message.toLowerCase();
  // SSRF / private-IP failures from assertPublicIpAddress / safeFetch.
  return (
    message.includes('private') ||
    message.includes('blocked') ||
    message.includes('not allowed') ||
    message.includes('ssrf') ||
    message.includes('could not be resolved')
  );
}

/**
 * Deterministic executor: runs only sanitized, whitelisted primitives through
 * their registered handlers. Hard rails live here — time/rate bounds, no raw
 * HTTP from the planner, no mutating methods (handlers use GET via safeFetch).
 *
 * Soft per-step failures are skipped; UrlSafetyError / SSRF failures abort the
 * whole plan (fail closed — never probe a private/blocked host).
 */
export async function executeProbePlan(
  plan: readonly ProbePlanStep[],
  ctx: ProbeExecutionContext,
): Promise<ProbePlanResult> {
  const maxSteps = ctx.maxSteps ?? PROBE_MAX_STEPS;
  const maxDurationMs = ctx.maxDurationMs ?? PROBE_MAX_DURATION_MS;
  const startedAt = Date.now();

  const findings: WebFinding[] = [];
  const evidence: ProbeStepEvidence[] = [];
  const openTables: string[] = [];
  let executed = 0;
  let skipped = 0;

  const bounded = plan.slice(0, maxSteps);

  for (const step of bounded) {
    if (Date.now() - startedAt > maxDurationMs) {
      skipped += bounded.length - executed;
      break;
    }

    if (!isProbePrimitiveName(step.primitive)) {
      skipped += 1;
      continue;
    }

    const definition = PROBE_REGISTRY[step.primitive];
    const parsed = definition.paramsSchema.safeParse(step.params);
    if (!parsed.success) {
      skipped += 1;
      continue;
    }

    try {
      const result = await definition.execute(parsed.data, ctx);
      findings.push(...result.findings);
      evidence.push(...result.evidence);
      if (result.openTable) openTables.push(result.openTable);
      executed += 1;
    } catch (error) {
      if (isHardSafetyError(error)) throw error;
      // A single soft step failure must not abort the plan or escalate privileges.
      skipped += 1;
    }
  }

  findings.push(...buildAnonWriteImpliedFindings(openTables));

  return { findings, evidence, executed, skipped };
}
