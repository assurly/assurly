import {
  AiUnavailableError,
  asUntrustedData,
  assertAiBudget,
  callClaude,
  MODELS,
  recordAiUsage,
  type ClaudeClientDeps,
} from './claudeClient';
import {
  DEFAULT_SENSITIVE_SUPABASE_TABLES,
  PROBE_MAX_STEPS,
  describeWhitelistedPrimitives,
  sanitizeProbePlan,
  type ProbePlanStep,
} from '../probes';

/**
 * Signals the planner may use. Scanned content must be treated as untrusted
 * data (wrapped with `asUntrustedData` before any LLM call).
 */
export interface RedTeamSignals {
  targetOrigin: string;
  hasSupabase: boolean;
  /** Present only when extracted from the page — never LLM-supplied. */
  supabaseHost?: string;
  generatorFingerprint?: string;
  frameworkHints?: string[];
  /**
   * Truncated HTML/bundle text used to infer table names. Always passed through
   * `asUntrustedData` — never trusted as instructions.
   */
  scannedSnippet?: string;
  /** Deterministic `.from('…')` / `.from("…")` hits extracted without AI. */
  heuristicTables?: string[];
}

export interface PlanRedTeamOptions {
  organizationId?: string;
  /** When false, skip the LLM and return the deterministic fallback plan. */
  useAi?: boolean;
  deps?: ClaudeClientDeps;
}

function buildPlannerSystemPrompt(): string {
  return [
    "You are Assurly's red-team probe planner.",
    'You select a SHORT ordered list of safe probe primitives to run against an owned app.',
    'You NEVER emit raw HTTP, URLs, methods, headers, or credentials.',
    'You ONLY choose from the whitelisted primitives listed below.',
    'Return ONLY a JSON array of objects shaped like {"primitive":"<name>","params":{...}}.',
    'No markdown, no commentary.',
    '',
    'Whitelisted primitives:',
    describeWhitelistedPrimitives(),
    '',
    'Rules:',
    `- At most ${PROBE_MAX_STEPS} steps.`,
    '- INFER the likely database tables from the product described on the scanned page. The business entities a SaaS manages — its records, billing objects, and user-owned data — usually map one-to-one to snake_case tables. Probe those you infer this way even when they are NOT in the heuristic list; this is where you add value over a fixed checklist.',
    '- Always include the provided heuristic table names and the obviously-sensitive common tables (users, accounts, and anything holding customer or payment data).',
    '- Use lowercase snake_case table names. Prefer supabase_rls_table_read when Supabase is present; otherwise return [].',
  ].join('\n');
}

/**
 * Builds the deterministic Layer-1 plan from the default sensitive table list
 * plus any heuristic table names found in the bundle. Always available when AI
 * is disabled or fails — keeps the gate reproducible.
 */
export function buildDeterministicProbePlan(signals: RedTeamSignals): ProbePlanStep[] {
  if (!signals.hasSupabase) return [];

  // Heuristic (`.from(...)`) tables are app-specific and higher-signal than the
  // generic defaults, so probe them first and fill the remaining budget from the
  // curated list — otherwise an expanded default list would crowd them out.
  const tables = new Set<string>();
  for (const name of signals.heuristicTables ?? []) {
    if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) tables.add(name);
  }
  for (const table of DEFAULT_SENSITIVE_SUPABASE_TABLES) tables.add(table);

  const steps: ProbePlanStep[] = [...tables].slice(0, PROBE_MAX_STEPS).map((table) => ({
    primitive: 'supabase_rls_table_read' as const,
    params: { table },
  }));

  return sanitizeProbePlan(steps);
}

function extractJsonArray(text: string): unknown {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    const start = trimmed.indexOf('[');
    const end = trimmed.lastIndexOf(']');
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(trimmed.slice(start, end + 1)) as unknown;
      } catch {
        return null;
      }
    }
    return null;
  }
}

/**
 * Plans a bounded sequence of whitelisted probe primitives. Uses the fast model
 * when AI is available; otherwise (and on any failure) returns the deterministic
 * fallback. AI is never on the critical path.
 *
 * IMPORTANT: Callers must only invoke this AFTER `isActiveProbeAllowed` is true
 * (and only with `activeProbe: true` on the scan). The planner itself does not
 * re-check ownership — the gate is the caller's responsibility.
 */
export async function planRedTeamProbes(
  signals: RedTeamSignals,
  options: PlanRedTeamOptions = {},
): Promise<{ plan: ProbePlanStep[]; source: 'ai' | 'deterministic' }> {
  const fallback = buildDeterministicProbePlan(signals);

  if (!signals.hasSupabase) {
    return { plan: [], source: 'deterministic' };
  }

  if (options.useAi === false) {
    return { plan: fallback, source: 'deterministic' };
  }

  try {
    if (options.organizationId) assertAiBudget(options.organizationId);

    const signalBlock = [
      `targetOrigin: ${signals.targetOrigin}`,
      `hasSupabase: ${signals.hasSupabase}`,
      signals.supabaseHost ? `supabaseHost: ${signals.supabaseHost}` : null,
      signals.generatorFingerprint ? `generatorFingerprint: ${signals.generatorFingerprint}` : null,
      signals.frameworkHints?.length
        ? `frameworkHints: ${signals.frameworkHints.join(', ')}`
        : null,
      signals.heuristicTables?.length
        ? `heuristicTables: ${signals.heuristicTables.join(', ')}`
        : null,
    ]
      .filter(Boolean)
      .join('\n');

    const snippet = signals.scannedSnippet
      ? `\n\nScanned page/bundle excerpt:\n${asUntrustedData(signals.scannedSnippet.slice(0, 4_000))}`
      : '';

    const text = await callClaude(
      {
        model: MODELS.fast,
        system: buildPlannerSystemPrompt(),
        messages: [
          {
            role: 'user',
            content: `Plan safe probes for this app.\n${signalBlock}${snippet}`,
          },
        ],
        maxTokens: 600,
      },
      options.deps,
    );

    if (options.organizationId) {
      // Approximate token spend for the stub budget store.
      recordAiUsage(options.organizationId, Math.ceil(text.length / 4) + 200);
    }

    const parsed = extractJsonArray(text);
    const plan = sanitizeProbePlan(parsed);
    if (plan.length === 0) {
      return { plan: fallback, source: 'deterministic' };
    }
    return { plan, source: 'ai' };
  } catch (error) {
    if (!(error instanceof AiUnavailableError)) {
      console.warn('[Assurly] red-team planner failed:', (error as Error).message);
    }
    return { plan: fallback, source: 'deterministic' };
  }
}

/**
 * Extracts likely Supabase/PostgREST table names from client code without AI.
 * Conservative — only `.from('table')` / `.from("table")` style hits.
 */
export function extractHeuristicTableNames(text: string): string[] {
  const found = new Set<string>();
  const pattern = /\.from\(\s*['"]([A-Za-z_][A-Za-z0-9_]{0,63})['"]\s*\)/g;
  for (const match of text.matchAll(pattern)) {
    const name = match[1];
    if (name) found.add(name);
  }
  return [...found].slice(0, PROBE_MAX_STEPS);
}
