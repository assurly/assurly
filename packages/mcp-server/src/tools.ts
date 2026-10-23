import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import * as fs from 'fs';
import * as path from 'path';
import { mergeCanaryPlantIntoEnvExample } from '@assurly/scanner-core';
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
  'assurly_scan_agent',
  'assurly_plant_canary',
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
  /** Deployed app URL. Live Lock checks this URL; a repo name is not enough. */
  url?: string;
  /** Git commit the deploy is built from. Required so a stored score cannot be reused. */
  gitSha?: string;
  /** Stable id for this attempt. Defaults to `mcp-<gitSha>` so a retry does not probe twice. */
  attemptId?: string;
}

export interface PlantCanaryInput {
  path: string;
  repo: string;
}

/**
 * Config for the `assurly_verdict` tool. It asks the hosted Live Lock for a
 * fresh READY or BLOCKED. It does not scan source locally. The API key lives
 * in the caller's environment, never in this package.
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

/** The Live Lock response. Shape-only: no table names and no samples. */
interface LiveLockVerdict {
  status?: 'ready' | 'blocked' | string;
  shipScore?: number | null;
  reason?: string;
  gitSha?: string;
  attemptId?: string;
  checkedAt?: string;
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

/**
 * Advisory audit of the developer's agent environment (MCP configs +
 * instruction files). `isError` stays false under all outcomes — this is not a
 * ship gate.
 */
export async function handleScanAgent(input: ScanPathInput): Promise<CallToolResult> {
  const result = await scanProjectDirectory(input.path, { agentOnly: true });
  const formatted = formatScanToolResult(result);
  return { ...formatted, isError: false };
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
const GIT_SHA = /^[0-9a-f]{7,64}$/i;

export async function handleVerdict(
  input: VerdictInput,
  config: VerdictToolConfig,
): Promise<CallToolResult> {
  const url = typeof input.url === 'string' ? input.url.trim() : '';
  const gitSha = typeof input.gitSha === 'string' ? input.gitSha.trim().toLowerCase() : '';
  if (!url || !GIT_SHA.test(gitSha)) {
    return errorResult(
      'Live Lock needs the deployed `url` and the `gitSha` of the commit being deployed. A stored score is not a ship decision.',
    );
  }
  if (!config.apiKey) {
    return errorResult(
      'ASSURLY_API_KEY is not set. Create a key in the Assurly dashboard (Settings → API keys) ' +
        'and expose it to this MCP server as ASSURLY_API_KEY.',
    );
  }

  const attemptId =
    typeof input.attemptId === 'string' && input.attemptId.trim().length > 0
      ? input.attemptId.trim()
      : `mcp-${gitSha}`;

  const doFetch = config.fetchImpl ?? fetch;
  const base = config.apiUrl.replace(/\/$/, '');

  let response: Response;
  try {
    response = await doFetch(`${base}/api/v1/live-lock`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({ url, gitSha, attemptId }),
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

  const verdict = (await response.json()) as LiveLockVerdict;
  const status = verdict.status === 'ready' ? 'ready' : 'blocked';
  const score = typeof verdict.shipScore === 'number' ? `${verdict.shipScore}/100` : 'n/a';
  const lines = [
    `Assurly Live Lock: ${status.toUpperCase()} · Ship Score ${score}`,
    `Target: ${url}`,
    `Commit: ${verdict.gitSha ?? gitSha}`,
    status === 'ready'
      ? 'This fresh check found no blockers. READY applies only to this run.'
      : `BLOCKED (${verdict.reason ?? 'runtime_blocker'}). Do not deploy. Open the Assurly proof for this URL.`,
  ];

  return {
    content: [
      { type: 'text', text: lines.join('\n') },
      { type: 'text', text: JSON.stringify(verdict, null, 2) },
    ],
    isError: status === 'blocked',
  };
}

interface HostedCanaryPlant {
  snippet?: string;
  mcpSnippet?: string;
  callbackUrl?: string;
  plantHint?: string;
}

/**
 * Mint a silent-alarm URL via the hosted API and write it to local
 * `.env.example`. Never uploads source.
 */
export async function handlePlantCanary(
  input: PlantCanaryInput,
  config: VerdictToolConfig,
): Promise<CallToolResult> {
  if (!config.apiKey) {
    return errorResult(
      'ASSURLY_API_KEY is not set. Create a key in the Assurly dashboard (Settings → API keys) ' +
        'and expose it to this MCP server as ASSURLY_API_KEY.',
    );
  }
  const repo = input.repo.trim();
  if (!repo.includes('/')) {
    return errorResult('Provide `repo` in owner/name form.');
  }

  const doFetch = config.fetchImpl ?? fetch;
  const base = config.apiUrl.replace(/\/$/, '');
  let response: Response;
  try {
    response = await doFetch(`${base}/api/v1/canary`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({ repo }),
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

  const payload = (await response.json()) as HostedCanaryPlant;
  const snippet = payload.snippet?.trim() ?? '';
  if (!snippet) {
    return errorResult('The Assurly API did not return a plant snippet.');
  }

  const projectRoot = path.resolve(input.path);
  const envPath = path.join(projectRoot, '.env.example');
  const existing = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';
  const merged = mergeCanaryPlantIntoEnvExample(existing, snippet);
  if (merged.changed) {
    fs.writeFileSync(envPath, merged.content, 'utf8');
  }

  const lines = [
    merged.changed
      ? `Planted silent alarm in ${envPath}.`
      : `Silent alarm already present in ${envPath}.`,
    payload.callbackUrl ? `Callback: ${payload.callbackUrl}` : '',
    'Do not enable the decoy MCP server in Cursor — add assurly-cloud-auth to disabledMcpjsonServers.',
    payload.mcpSnippet ? `MCP decoy snippet:\n${payload.mcpSnippet}` : '',
  ].filter((line) => line.length > 0);

  return {
    content: [
      { type: 'text', text: lines.join('\n') },
      {
        type: 'text',
        text: JSON.stringify({ ...payload, wroteEnvExample: merged.changed }, null, 2),
      },
    ],
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
