import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import type { WebFinding } from '../browserScanner';
import { getCuratedConsequence, ruleIdFromGroupKey } from '../consequenceMap';
import type { ScanLiveUrlResult } from '../runtimeScanner';
import { describeBlockedScan } from '../scannerBlocked';
import { buildShipGateFromWebFindings, type ShipGateReport } from '../shipGate';
import { assertScannableUrl, UrlSafetyError } from '../urlSafety';
import type { Allowance } from './limits';
import { toSafeText } from './safeText';

export const CHECK_LIVE_APP_TOOL = 'check_live_app';

/**
 * Claude decides from this text whether to call the tool, so it names the
 * situations and words people actually use. It must only describe the tool:
 * directory review rejects descriptions that instruct Claude or promote.
 */
export const CHECK_LIVE_APP_DESCRIPTION = [
  'Security scan of a live, deployed web app, seen from the outside the way a stranger on the internet sees it.',
  'Finds leaked secret keys in the page or its JavaScript (Stripe, AWS, Google and Supabase service-role keys),',
  'a Supabase database reachable with the public key, missing security headers',
  '(Content-Security-Policy, Strict-Transport-Security, X-Content-Type-Options) and deployments that are down.',
  'Returns a ship verdict (ready, review or blocked), a Ship Score from 0 to 100,',
  'and for each problem what it means and how to fix it.',
  'Use when the user asks whether a live app or website is secure or safe to launch,',
  'wants it checked for security issues or leaked API keys before going live,',
  'or wants to confirm a fix after redeploying.',
  'Works for any public URL, including apps built with Lovable, Bolt, v0, Replit or Cursor.',
  'Passive: it loads the public page and scripts like a browser; it never logs in, submits data or reads the database.',
].join(' ');

const MAX_LISTED_FINDINGS = 10;
const MAX_TEXT = 600;

const SCOPE = toSafeText(
  'Passive check: Assurly loaded the public page and its scripts the way any visitor’s browser does. ' +
    'It did not log in, send data or try to read the database, so it cannot tell whether exposed ' +
    'database tables are actually readable — that needs an owner-verified active test at assurly.dev.',
  MAX_TEXT,
);

const NO_VERDICT_SCOPE =
  'No verdict: Assurly never saw the app, so this result says nothing about its security.';

export const checkLiveAppInputSchema = z
  .object({
    url: z
      .string()
      .min(1)
      .max(2048)
      .describe('Public URL of the deployed app, e.g. https://my-app.lovable.app'),
  })
  .strict();

const findingSchema = z.object({
  rule: z.string(),
  severity: z.enum(['error', 'warning']),
  blocksShip: z.boolean(),
  issue: z.string(),
  impact: z.string().optional(),
  fix: z.string().optional(),
});

export const checkLiveAppOutputSchema = z.object({
  url: z.string(),
  checkedAt: z.string(),
  verdict: z.enum(['ready', 'review', 'blocked', 'no_verdict']),
  shipScore: z.number().int().min(0).max(100).nullable(),
  summary: z.string(),
  findings: z.array(findingSchema),
  omittedFindings: z.number().int().min(0),
  coverage: z.enum(['complete', 'partial', 'none']),
  scope: z.string(),
});

type CheckLiveAppOutput = z.infer<typeof checkLiveAppOutputSchema>;
type ListedFinding = z.infer<typeof findingSchema>;

export interface CheckLiveAppDeps {
  clientIp: string;
  scan: (
    url: string,
    fetchImpl: typeof fetch,
    lookupImpl: undefined,
    options: { activeProbe: false; visibilityAudit: false; useAiPlanner: false },
  ) => Promise<ScanLiveUrlResult>;
  allowScan: (clientIp: string, hostname: string) => Promise<Allowance>;
  now: () => Date;
}

const VERDICT_LABEL: Record<ShipGateReport['status'], string> = {
  ready: 'Ready to ship',
  review: 'Review recommended',
  blocked: 'Not ready to ship',
};

/** People type `my-app.lovable.app`; the scanner needs a scheme. */
function normalizeTargetUrl(raw: string): URL {
  const trimmed = raw.trim();
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  return assertScannableUrl(withScheme);
}

function failure(message: string): CallToolResult {
  return { content: [{ type: 'text', text: toSafeText(message, MAX_TEXT) }], isError: true };
}

function formatWait(seconds: number): string {
  if (seconds <= 60) return 'about a minute';
  if (seconds < 3600) return `${Math.ceil(seconds / 60)} minutes`;
  return `${Math.ceil(seconds / 3600)} hours`;
}

function refusalMessage(allowance: Extract<Allowance, { allowed: false }>): string {
  const wait = formatWait(allowance.retryAfterSeconds);
  switch (allowance.reason) {
    case 'target':
      return `This site was checked several times in the last few minutes. Try again in ${wait}.`;
    case 'client':
      return `Too many checks from this address. Try again in ${wait}.`;
    case 'capacity':
      return `Assurly's public check is at capacity. Try again in ${wait}.`;
  }
}

/**
 * Why the page itself could not be loaded, or null when the error is not a
 * network failure (and so is ours to report as an internal error).
 */
function unreachableReason(error: unknown, host: string): string | null {
  if (!(error instanceof Error)) return null;
  const code = (error as Error & { code?: unknown }).code;
  if (error.name === 'TimeoutError' || error.name === 'AbortError') {
    return `${host} did not answer within 8 seconds.`;
  }
  if (
    code === 'ENOTFOUND' ||
    code === 'EAI_AGAIN' ||
    error.message === 'Target host could not be resolved.'
  ) {
    return `The domain ${host} does not resolve to a server.`;
  }
  if (error.message.startsWith('Too many redirects')) {
    return `${host} redirects too many times to reach a page.`;
  }
  if (error instanceof TypeError && error.message === 'fetch failed') {
    return `Could not connect to ${host} (connection refused or a TLS certificate problem).`;
  }
  return null;
}

function coverageOf(result: ScanLiveUrlResult): CheckLiveAppOutput['coverage'] {
  const coverage = result.bundleCoverage;
  if (!coverage) return 'complete';
  return coverage.truncatedBy || coverage.failed > 0 ? 'partial' : 'complete';
}

function listFindings(findings: WebFinding[], report: ShipGateReport): ListedFinding[] {
  const blockerRules = new Set(
    report.blockers.map((group) => ruleIdFromGroupKey(group.id)).filter(Boolean),
  );
  const seen = new Set<string>();
  const unique = findings.filter((finding) => {
    const key = `${finding.ruleId}|${finding.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const ordered = [
    ...unique.filter((finding) => finding.severity === 'error'),
    ...unique.filter((finding) => finding.severity !== 'error'),
  ];
  return ordered.map((finding) => {
    const impact = getCuratedConsequence(finding.ruleId)?.consequence;
    return {
      rule: toSafeText(finding.ruleId, 80),
      severity: finding.severity === 'error' ? 'error' : 'warning',
      blocksShip: blockerRules.has(finding.ruleId),
      issue: toSafeText(finding.message, MAX_TEXT),
      ...(impact ? { impact: toSafeText(impact, MAX_TEXT) } : {}),
      ...(finding.suggestion ? { fix: toSafeText(finding.suggestion, MAX_TEXT) } : {}),
    };
  });
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

function summarize(listed: ListedFinding[]): string {
  if (listed.length === 0) return 'No problems were visible from the outside.';
  const blockers = listed.filter((finding) => finding.blocksShip).length;
  const others = listed.length - blockers;
  if (blockers === 0) return `${plural(others, 'problem')} to review, none blocking.`;
  if (others === 0) return `${plural(blockers, 'blocking problem')}.`;
  return `${plural(blockers, 'blocking problem')} and ${others} more to review.`;
}

function renderText(output: CheckLiveAppOutput): string {
  const heading =
    output.verdict === 'no_verdict'
      ? `Assurly could not check ${output.url}`
      : `Assurly check of ${output.url}: ${VERDICT_LABEL[output.verdict]} (Ship Score ${output.shipScore}/100)`;
  const findingLines = output.findings.flatMap((finding, index) => [
    `${index + 1}. [${finding.blocksShip ? 'blocker' : finding.severity}] ${finding.issue}`,
    ...(finding.impact ? [`   Why it matters: ${finding.impact}`] : []),
    ...(finding.fix ? [`   Fix: ${finding.fix}`] : []),
  ]);
  return [
    heading,
    output.summary,
    ...(findingLines.length > 0 ? ['', ...findingLines] : []),
    ...(output.omittedFindings > 0 ? [`…and ${output.omittedFindings} more.`] : []),
    ...(output.coverage === 'partial'
      ? [
          '',
          'Coverage: some of the app’s scripts could not be read, so problems in them may be missing.',
        ]
      : []),
    '',
    output.scope,
  ].join('\n');
}

function result(output: CheckLiveAppOutput): CallToolResult {
  return {
    content: [{ type: 'text', text: renderText(output) }],
    structuredContent: output,
  };
}

function noVerdict(url: string, checkedAt: string, summary: string): CallToolResult {
  return result({
    url,
    checkedAt,
    verdict: 'no_verdict',
    shipScore: null,
    summary: toSafeText(summary, MAX_TEXT),
    findings: [],
    omittedFindings: 0,
    coverage: 'none',
    scope: NO_VERDICT_SCOPE,
  });
}

function log(details: Record<string, unknown>): void {
  console.info(JSON.stringify({ service: 'assurly-mcp', tool: CHECK_LIVE_APP_TOOL, ...details }));
}

export async function checkLiveApp(
  input: z.infer<typeof checkLiveAppInputSchema>,
  deps: CheckLiveAppDeps,
): Promise<CallToolResult> {
  let target: URL;
  try {
    target = normalizeTargetUrl(input.url);
  } catch (error) {
    if (error instanceof UrlSafetyError) {
      return failure(
        `Cannot check this address: ${error.message} Use the public URL of the deployed app, for example https://my-app.lovable.app.`,
      );
    }
    throw error;
  }

  const allowance = await deps.allowScan(deps.clientIp, target.hostname);
  if (!allowance.allowed) {
    log({ host: target.hostname, outcome: `refused:${allowance.reason}` });
    return failure(refusalMessage(allowance));
  }

  const url = target.toString();
  const startedAt = Date.now();
  let scanned: ScanLiveUrlResult;
  try {
    // The public connector never runs the active probe or the AI planner:
    // nobody here has proven they own the target.
    scanned = await deps.scan(url, fetch, undefined, {
      activeProbe: false,
      visibilityAudit: false,
      useAiPlanner: false,
    });
  } catch (error) {
    const checkedAt = deps.now().toISOString();
    if (error instanceof UrlSafetyError) {
      log({ host: target.hostname, outcome: 'refused:private' });
      return failure(`Cannot check ${target.hostname}: it resolves to a private network address.`);
    }
    const reason = unreachableReason(error, target.hostname);
    if (reason) {
      log({ host: target.hostname, outcome: 'unreachable', durationMs: Date.now() - startedAt });
      return noVerdict(
        url,
        checkedAt,
        `${reason} Check that the app is deployed and public, then try again.`,
      );
    }
    console.error(
      JSON.stringify({
        service: 'assurly-mcp',
        tool: CHECK_LIVE_APP_TOOL,
        host: target.hostname,
        errorType: error instanceof Error ? error.name : 'UnknownError',
        errorMessage: error instanceof Error ? error.message : String(error),
      }),
    );
    return failure(
      'Assurly could not finish this check because of an internal error. Try again in a minute.',
    );
  }

  const checkedAt = deps.now().toISOString();
  if (scanned.blocked) {
    const copy = describeBlockedScan(scanned.blocked);
    log({ host: target.hostname, outcome: `blocked:${scanned.blocked.source}` });
    return noVerdict(url, checkedAt, `${copy.title}. ${copy.detail}`);
  }

  const report = buildShipGateFromWebFindings(scanned.findings, {
    scannedFileCount: 1,
    cleanFileCount: scanned.findings.length === 0 ? 1 : 0,
  });
  const listed = listFindings(scanned.findings, report);
  const output: CheckLiveAppOutput = {
    url,
    checkedAt,
    verdict: report.status,
    shipScore: report.shipScore,
    summary: summarize(listed),
    findings: listed.slice(0, MAX_LISTED_FINDINGS),
    omittedFindings: Math.max(0, listed.length - MAX_LISTED_FINDINGS),
    coverage: coverageOf(scanned),
    scope: SCOPE,
  };
  log({
    host: target.hostname,
    outcome: 'checked',
    verdict: output.verdict,
    findings: listed.length,
    durationMs: Date.now() - startedAt,
  });
  return result(output);
}
