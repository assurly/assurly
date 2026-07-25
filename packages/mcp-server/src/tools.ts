import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { explainRule } from 'assurly/ruleExplainer';
import {
  scanProjectDirectory,
  scanProjectFiles,
  type ScanProjectFileInput,
  type ScanProjectResult,
} from 'assurly/scanProject';

export const ASSURLY_MCP_TOOL_NAMES = [
  'assurly_scan_path',
  'assurly_scan_files',
  'assurly_explain_rule',
  'assurly_verdict',
] as const;

export type AssurlyMcpToolName = (typeof ASSURLY_MCP_TOOL_NAMES)[number];

export interface ScanPathInput {
  path: string;
}

export interface ScanFilesInput {
  files: ScanProjectFileInput[];
}

export interface ExplainRuleInput {
  ruleId: string;
}

export interface VerdictInput {
  url?: string;
  repo?: string;
}

/**
 * Config for the `assurly_verdict` tool. It READS the hosted Assurly API — it
 * does NOT scan or probe locally. The API key (an org's programmatic key) is the
 * only secret and lives in the caller's environment, never in this package.
 */
export interface VerdictToolConfig {
  /** Base URL of the hosted Assurly app, e.g. `https://assurly.dev`. */
  apiUrl: string;
  /** The org's programmatic API key (from `ASSURLY_API_KEY`). */
  apiKey?: string;
  /** Injectable for tests; defaults to the global `fetch`. */
  fetchImpl?: typeof fetch;
}

/** Shape-only per-rule fix outcome from the hosted verdict API. */
interface HostedFixOutcome {
  ruleId?: string;
  outcome?: 'verified_fixed' | 'still_open' | 'regressed' | string;
  /** ISO-8601 timestamp of the re-probe that produced this observation. */
  observedAt?: string;
}

/** The shape-only verdict the hosted `GET /api/v1/verdict` returns. */
interface HostedVerdict {
  status?: string;
  shipScore?: number | null;
  displayName?: string | null;
  identifier?: string;
  kind?: string;
  lastCheckedAt?: string | null;
  topIssue?: { category?: string; severity?: string; remediation?: string } | null;
  trustPageUrl?: string | null;
  badgeUrl?: string | null;
  activeProbeAllowed?: boolean;
  fixOutcomes?: HostedFixOutcome[];
}

/**
 * Formats stored fix outcomes for the agent-facing text block.
 *
 * Outcomes reflect the *last re-probe*, not the agent's working tree. Always
 * include the observation timestamp and the "not yet verified" guidance so a
 * post-edit `assurly_verdict` call cannot be read as "your fix failed" when
 * nothing was measured after the edit. We deliberately do NOT map `still_open`
 * to `isError` for the same reason — see `handleVerdict`.
 */
export function formatFixOutcomesText(outcomes: HostedFixOutcome[]): string {
  if (outcomes.length === 0) {
    return 'Fix outcomes: none recorded yet. After deploying a claimed fix, re-probe before treating it as done.';
  }

  const lines = outcomes.map((entry) => {
    const ruleId = entry.ruleId ?? 'unknown-rule';
    const outcome = entry.outcome ?? 'unknown';
    const when = entry.observedAt ?? 'unknown time';
    return `  · ${ruleId}: ${outcome} · observed ${when}`;
  });

  return [
    'Fix outcomes (last re-probe only — may predate your latest edit):',
    ...lines,
    'Not yet verified against your latest changes — deploy and re-probe. An unverified claim is not done.',
  ].join('\n');
}

function formatScanToolResult(result: ScanProjectResult): CallToolResult {
  const payload = {
    verdict: result.report.headline,
    status: result.report.status,
    shipScore: result.report.shipScore,
    blockers: result.report.blockers,
    reviews: result.report.reviews,
    warnings: result.report.warnings,
    findings: result.findings,
    detectedStack: result.context.detectedStack,
    scanScope: result.context.scanScope,
    report: result.report,
  };

  return {
    content: [
      {
        type: 'text',
        text: result.summary,
      },
      {
        type: 'text',
        text: `Markdown report:\n\n${result.markdown}`,
      },
      {
        type: 'text',
        text: JSON.stringify(payload, null, 2),
      },
    ],
  };
}

export async function handleScanPath(input: ScanPathInput): Promise<CallToolResult> {
  const result = await scanProjectDirectory(input.path);
  return formatScanToolResult(result);
}

export async function handleScanFiles(input: ScanFilesInput): Promise<CallToolResult> {
  const result = await scanProjectFiles(input.files);
  return formatScanToolResult(result);
}

function errorResult(text: string): CallToolResult {
  return { content: [{ type: 'text', text }], isError: true };
}

/**
 * Pre-deploy ship gate for agents. READS the hosted Assurly verdict for a URL or
 * repo — it never scans or probes locally, and never triggers an active probe on
 * the hosted side (the API is read-only over existing verdicts). For a target the
 * caller's org has not ownership-verified, the hosted API returns the passive
 * verdict only. Shape-only: coarse category + generic remediation + per-rule
 * fix outcomes (`ruleId`/`outcome`/`observedAt`), never evidence.
 *
 * `isError` stays `status === 'blocked'` only. Fix outcomes (`still_open` /
 * `regressed`) are NOT errors: the tool cannot know which finding the agent
 * claimed to fix, outcomes may predate the agent's latest edit, and crying wolf
 * on stale `still_open` would train agents to ignore the gate. Enforcement of
 * "re-verify after claiming a fix" lives in the agent contract
 * (`GATE_RULES_SNIPPET`) plus the explicit "not yet verified" wording below.
 */
export async function handleVerdict(
  input: VerdictInput,
  config: VerdictToolConfig,
): Promise<CallToolResult> {
  const hasUrl = typeof input.url === 'string' && input.url.length > 0;
  const hasRepo = typeof input.repo === 'string' && input.repo.length > 0;
  if (hasUrl === hasRepo) {
    return errorResult('Provide exactly one of `url` or `repo`.');
  }
  if (!config.apiKey) {
    return errorResult(
      'ASSURLY_API_KEY is not set. Create a key in the Assurly dashboard (Settings → API keys) ' +
        'and expose it to this MCP server as ASSURLY_API_KEY.',
    );
  }

  const doFetch = config.fetchImpl ?? fetch;
  const base = config.apiUrl.replace(/\/$/, '');
  const query = hasUrl
    ? `url=${encodeURIComponent(input.url as string)}`
    : `repo=${encodeURIComponent(input.repo as string)}`;

  let response: Response;
  try {
    response = await doFetch(`${base}/api/v1/verdict?${query}`, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return errorResult(`Could not reach the Assurly API: ${message}`);
  }

  if (response.status === 401) {
    return errorResult('The Assurly API key is invalid or revoked (401). Issue a new key.');
  }
  if (!response.ok) {
    return errorResult(`The Assurly API returned an error (${response.status}).`);
  }

  const verdict = (await response.json()) as HostedVerdict;
  const status = verdict.status ?? 'unknown';
  const score = typeof verdict.shipScore === 'number' ? `${verdict.shipScore}/100` : 'n/a';
  const shipReady = status === 'ready';
  const fixOutcomes = Array.isArray(verdict.fixOutcomes) ? verdict.fixOutcomes : [];

  const lines: string[] = [
    `Assurly verdict: ${status.toUpperCase()} · Ship Score ${score}`,
    verdict.displayName || verdict.identifier
      ? `Target: ${verdict.displayName ?? verdict.identifier}`
      : '',
    shipReady
      ? 'No blocking issues detected — safe to ship.'
      : verdict.topIssue
        ? `Top issue: ${verdict.topIssue.category ?? 'Security issue'}${
            verdict.topIssue.remediation ? ` — ${verdict.topIssue.remediation}` : ''
          }`
        : status === 'unknown'
          ? 'No published verdict for this target yet. Scan it in Assurly first.'
          : 'Review the issues in the Assurly dashboard before shipping.',
    formatFixOutcomesText(fixOutcomes),
    verdict.trustPageUrl ? `Trust page: ${verdict.trustPageUrl}` : '',
  ].filter((line) => line.length > 0);

  return {
    content: [
      { type: 'text', text: lines.join('\n') },
      { type: 'text', text: JSON.stringify(verdict, null, 2) },
    ],
    // Blocked status is the only ship-gate halt. See docstring for why fix
    // outcomes never widen isError.
    isError: status === 'blocked',
  };
}

export function handleExplainRule(input: ExplainRuleInput): CallToolResult {
  const explanation = explainRule(input.ruleId);
  if (!explanation) {
    return {
      content: [
        {
          type: 'text',
          text: `Unknown rule id: ${input.ruleId}`,
        },
      ],
      isError: true,
    };
  }

  const text = [
    `# ${explanation.title}`,
    '',
    `Rule ID: ${explanation.ruleId}`,
    `Blocks ship when high-confidence: ${explanation.blocksShip ? 'yes' : 'no'}`,
    '',
    '## What this rule checks',
    explanation.explanation,
    '',
    '## How to fix',
    explanation.howToFix,
  ].join('\n');

  return {
    content: [
      {
        type: 'text',
        text,
      },
      {
        type: 'text',
        text: JSON.stringify(explanation, null, 2),
      },
    ],
  };
}
