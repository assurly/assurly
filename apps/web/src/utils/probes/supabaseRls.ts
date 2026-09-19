import type { WebFinding } from '../browserScanner';
import { assertScannableUrl } from '../urlSafety';
import { pickRedactedSampleCell } from './redact';
import type { ProbeExecutionContext, ProbeStepEvidence, ProbeStepResult } from './types';

function supabaseHeaders(anonKey: string): HeadersInit {
  return {
    apikey: anonKey,
    Authorization: `Bearer ${anonKey}`,
    Accept: 'application/json',
  };
}

/**
 * Location string for a Supabase-table finding. The table name is part of the
 * finding's IDENTITY, not just its human message: regression detection keys on
 * `rule_id | file_path | line_number` (see `scanRegression.regressionKey`). If
 * every exposed table shared one `file_path`, a SECOND table getting exposed
 * would collapse onto the first table's key and never fire a "new blocker"
 * alert. Scoping the location to the table keeps the key stable AND distinct —
 * no volatile data (row counts live in evidence, never here).
 */
export function supabaseTableLocation(table: string): string {
  return `Supabase REST API · ${table}`;
}

/** Parses the total row count from a PostgREST `content-range: 0-0/1234` header. */
function parseContentRangeTotal(header: string | null): number | undefined {
  if (!header) return undefined;
  const total = header.split('/')[1];
  if (!total || total === '*') return undefined;
  const parsed = Number(total);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/**
 * Whitelisted primitive: non-mutating GET of one Supabase table via the anon key.
 * Host and credentials come from `ctx` (scanner-extracted), never from LLM params.
 * Only `params.table` is planner-chosen, and it is already zod-validated.
 *
 * Fetches go through `ctx.safeFetch` (the SSRF-safe path injected by the scanner).
 */
export async function executeSupabaseRlsTableRead(
  params: { table: string },
  ctx: ProbeExecutionContext,
): Promise<ProbeStepResult> {
  const { supabaseUrl, anonKey, fetchImpl, lookupImpl, safeFetch } = ctx;
  if (!supabaseUrl || !anonKey) {
    return { findings: [], evidence: [] };
  }

  // Attacker-controlled when extracted from a bundle — same SSRF guard as before.
  assertScannableUrl(supabaseUrl);

  const table = params.table;
  // `table` is zod-validated to `[A-Za-z_][A-Za-z0-9_]*` — safe as a path segment.
  const probeUrl = new URL(`/rest/v1/${table}`, supabaseUrl);
  probeUrl.searchParams.set('select', '*');
  probeUrl.searchParams.set('limit', '1');

  const { response } = await safeFetch(
    probeUrl.toString(),
    // count=exact proves scale without exfiltrating rows. GET only — never a mutation.
    { method: 'GET', headers: { ...supabaseHeaders(anonKey), Prefer: 'count=exact' } },
    fetchImpl,
    lookupImpl,
  );

  if (!response.ok) return { findings: [], evidence: [] };

  let rows: unknown[] = [];
  try {
    const payload = (await response.json()) as unknown;
    rows = Array.isArray(payload) ? payload : [];
  } catch {
    return { findings: [], evidence: [] };
  }

  if (rows.length === 0) return { findings: [], evidence: [] };

  const findings: WebFinding[] = [
    {
      ruleId: 'runtime-supabase-rls-open',
      severity: 'error',
      message: `Supabase table '${table}' returned rows via anon key without RLS protection.`,
      suggestion: `Enable row-level security and add policies for table '${table}'.`,
      file: supabaseTableLocation(table),
    },
  ];

  const totalRows = parseContentRangeTotal(response.headers.get('content-range')) ?? rows.length;
  const firstRow =
    rows[0] && typeof rows[0] === 'object' ? (rows[0] as Record<string, unknown>) : {};
  const columns = Object.keys(firstRow);
  const sampleCell = pickRedactedSampleCell(firstRow);
  const rowLabel = totalRows === 1 ? '1 row' : `${totalRows.toLocaleString('en-US')} rows`;

  const evidence: ProbeStepEvidence[] = [
    {
      findingRuleId: 'runtime-supabase-rls-open',
      kind: 'rls_rows',
      summary: `We read ${rowLabel} from your \`${table}\` table using only the public key.`,
      redactedSample: {
        table,
        rowCount: totalRows,
        columns,
        ...(sampleCell ? { sampleCell } : {}),
      },
    },
  ];

  return { findings, evidence, openTable: table };
}

/** Builds the write-implied warning for tables already proven readable. */
export function buildAnonWriteImpliedFindings(openTables: readonly string[]): WebFinding[] {
  return openTables.map((table) => ({
    ruleId: 'runtime-supabase-anon-write-implied',
    severity: 'warning' as const,
    message: `Table '${table}' is readable with the anon key; write access is likely possible if RLS policies are missing.`,
    suggestion:
      'Add restrictive RLS policies for SELECT, INSERT, UPDATE, and DELETE. This check infers risk only — no write probe was attempted.',
    file: supabaseTableLocation(table),
  }));
}
