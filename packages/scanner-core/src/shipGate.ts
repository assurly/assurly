import type { FindingConfidence, ScannerFinding, Severity } from './index';
import type { ScanScope } from './fileRelevance';
import { formatScanScopeSummary } from './fileRelevance';
import { findingKind, isCiWorkflowSuggestion } from './findingKind';
import { isAnalyzedCodeFile } from './languageCoverage';

export type ShipGateFindingInput = Pick<
  ScannerFinding,
  'severity' | 'message' | 'file' | 'line' | 'ruleId' | 'suggestion' | 'confidence'
>;

export type ShipGateActionKind = 'command' | 'link' | 'hint';

export interface ShipGateAction {
  label: string;
  kind: ShipGateActionKind;
  command?: string;
  href?: string;
  hint?: string;
}

export type ShipGateStatus = 'blocked' | 'review' | 'ready';

export interface ShipGateGroup {
  id: string;
  label: string;
  severity: Severity;
  occurrenceCount: number;
  affectedFileCount: number;
  sampleMessage: string;
  action?: ShipGateAction;
}

export interface ShipGateReport {
  status: ShipGateStatus;
  shipScore: number;
  headline: string;
  statusEmoji: string;
  blockers: ShipGateGroup[];
  /** Error-severity findings with medium/low confidence — review, not block. */
  reviews: ShipGateGroup[];
  warnings: ShipGateGroup[];
  cleanFileCount: number;
  scannedFileCount: number;
  totalErrorFindings: number;
  totalWarningFindings: number;
  scanScope?: ScanScope;
  /**
   * What this scan could not check. Shown beside the verdict, never scored.
   * Optional because reports also arrive as JSON built before it existed.
   */
  coverageNotes?: string[];
  /** Optional Assurly setup (CI workflow, silent alarm). Never findings, never scored. */
  setup?: ShipGateGroup[];
  /** Worth knowing, not a problem today (see findingKind `advisory`). Never scored. */
  advisories?: ShipGateGroup[];
  /**
   * True when part of the app could not be read (payment or login code in an
   * unsupported language, or a capped scan): the score covers the checked part.
   */
  partialCoverage?: boolean;
}

export interface ShipGateOptions {
  scannedFileCount?: number;
  cleanFileCount?: number;
  scanScope?: ScanScope;
}

const BLOCKER_PENALTY = 12;
const WARNING_PENALTY = 4;

/** Cannot-ship scores must not look like a passing grade. */
export const BLOCKED_SCORE_CAP = 59;

/** Extra missing-RLS tables stay listed but do not zero the score. */
export const RLS_SCORE_GROUP_CAP = 3;

function cappedRlsGroupCount(groups: readonly ShipGateGroup[]): number {
  const rlsCount = groups.filter((group) => group.id.startsWith('rls:')).length;
  return groups.length - rlsCount + Math.min(rlsCount, RLS_SCORE_GROUP_CAP);
}

function effectiveConfidence(confidence: FindingConfidence | undefined): FindingConfidence {
  return confidence ?? 'high';
}

/**
 * Agent-stack findings may be error+high for triage priority, but they audit
 * the developer's tooling — not the app under ship — and must never gate
 * deploy. They are also kept off `HIGH_CONFIDENCE_BLOCKER_RULE_IDS`.
 */
function isAgentStackRuleId(ruleId: string | undefined): boolean {
  return typeof ruleId === 'string' && ruleId.startsWith('agent-');
}

/**
 * Install-time trust (`supply-*`) findings are intentionally warning-only —
 * npm 12 is new and most projects will light up on first scan. Keeping ids off
 * `HIGH_CONFIDENCE_BLOCKER_RULE_IDS` was not enough for `agent-*` (severity can
 * still be raised); route `supply-*` away from blockers here too.
 */
function isSupplyChainRuleId(ruleId: string | undefined): boolean {
  return typeof ruleId === 'string' && ruleId.startsWith('supply-');
}

function isNonBlockingAdvisoryRuleId(ruleId: string | undefined): boolean {
  return isAgentStackRuleId(ruleId) || isSupplyChainRuleId(ruleId);
}

function isInformationalCanaryRuleId(ruleId: string | undefined): boolean {
  // Intentional tripwire — visible on the finding, never a Ship Gate warning.
  // Missing plant (`assurly-canary-missing`) stays a real warning with a CTA.
  return ruleId === 'assurly-canary-planted';
}

function isBlockerFinding(finding: ShipGateFindingInput): boolean {
  if (isNonBlockingAdvisoryRuleId(finding.ruleId)) return false;
  if (isInformationalCanaryRuleId(finding.ruleId)) return false;
  return finding.severity === 'error' && effectiveConfidence(finding.confidence) === 'high';
}

function isReviewFinding(finding: ShipGateFindingInput): boolean {
  if (finding.severity !== 'error') return false;
  if (isNonBlockingAdvisoryRuleId(finding.ruleId)) return true;
  return effectiveConfidence(finding.confidence) !== 'high';
}

function isWarningFinding(finding: ShipGateFindingInput): boolean {
  if (finding.severity !== 'warning') return false;
  if (isInformationalCanaryRuleId(finding.ruleId)) return false;
  return true;
}

function normalizeScanPath(filePath: string): string {
  return filePath.replace(/\\/g, '/');
}

/**
 * Instant Gate "N of M had no issues" must only subtract findings whose path
 * was in the scanned set. Pseudo-files (`Global Configs`) and config like
 * `.env.example` are not among the analysed JS/TS/SQL files.
 */
export function countCleanScannedFiles(
  scannedFileCount: number,
  findingFiles: readonly (string | undefined)[],
  scannedFiles?: readonly string[],
): number {
  const scannedSet = scannedFiles ? new Set(scannedFiles.map(normalizeScanPath)) : null;
  const affected = new Set<string>();

  for (const file of findingFiles) {
    if (!file) continue;
    const normalized = normalizeScanPath(file);
    if (scannedSet) {
      if (scannedSet.has(normalized)) {
        affected.add(normalized);
      }
      continue;
    }
    if (isAnalyzedCodeFile(normalized)) {
      affected.add(normalized);
    }
  }

  return Math.max(0, scannedFileCount - affected.size);
}

export function getFindingGroupKey(finding: ShipGateFindingInput): string {
  const message = (finding.message || '').toLowerCase();
  const envMatch = finding.message?.match(/variable 'process\.env\.([^']+)'/i);
  if (envMatch) return `env:${envMatch[1]}`;

  const rlsMatch = finding.message?.match(/table '([^']+)'/i);
  if (rlsMatch && message.includes('row-level security')) return `rls:${rlsMatch[1]}`;

  if (message.includes('stripe webhook') && message.includes('signature')) {
    return 'stripe:webhook-signature';
  }
  if (message.includes("client component ('use client') imports server-side module")) {
    return 'rsc:client-import';
  }
  if (message.includes('cold start') || message.includes('bundle size')) {
    return 'perf:cold-start';
  }
  if (message.includes('edge runtime')) return 'edge:runtime';
  if (isCiWorkflowSuggestion(finding)) return 'rule:github-actions-integration';

  if (finding.ruleId) return `rule:${finding.ruleId}`;

  return `msg:${message.replace(/\s+/g, ' ').trim()}`;
}

/**
 * Titles in the words of someone who did not write the code. Each one states
 * only what its rule checks; the precise message stays under the title.
 */
const PLAIN_RULE_TITLES: Readonly<Record<string, string>> = {
  'api-route-unvalidated-input': 'An API route accepts any input',
  'auth-route-handler-unprotected': 'A protected API route has no login check',
  'auth-route-handler-mutates-unguarded': 'An API route changes data without a login check',
  'auth-server-action-no-check': 'A server action runs without a login check',
  'auth-service-role-bypass': 'Admin database access runs without a login check',
  'ai-llm-key-in-client': 'Your AI provider key is in browser code',
  'ai-route-missing-authz': 'Anyone can call your AI route',
  'ai-missing-rate-limit': 'Your AI chat route has no usage limit',
  'ai-prompt-injection-surface': 'User text goes straight into your AI instructions',
  'ai-pii-to-model-context': 'Personal data may be sent to the AI model',
  'stripe-secret-leak': 'Your Stripe secret key is in the code',
  'stripe-live-key-in-dev': 'A live Stripe key is in a dev or test env file',
  'stripe-webhook-no-idempotency': 'Your Stripe webhook may process the same event twice',
  'supabase-storage-public-default': 'A storage bucket is public by default',
  'supabase-service-role-leak': 'Your Supabase admin key may reach the browser',
};

function issueGroupLabel(key: string, sampleMessage: string): string {
  if (key.startsWith('env:')) {
    return `${key.slice(4)} is missing from .env.example`;
  }
  if (key === 'rule:assurly-canary-missing') {
    return 'No silent alarm planted';
  }
  if (key.startsWith('rls:')) {
    return `Table ${key.slice(4)} has no row-level security`;
  }
  if (key === 'stripe:webhook-signature') return 'Your Stripe webhook does not check signatures';
  if (key === 'rsc:client-import') return 'A client component imports server-only code';
  if (key === 'perf:cold-start') return 'A route loads heavy code on every cold start';
  if (key === 'edge:runtime') return 'Edge runtime compatibility';
  if (key === 'rule:scan-language-coverage') return 'Backend code not analysed';
  if (key === 'rule:github-actions-integration') return 'Run Assurly on every push';
  const plain = key.startsWith('rule:') ? PLAIN_RULE_TITLES[key.slice(5)] : undefined;
  // Never cut a title short: "…against a …" told nobody what was wrong.
  return plain ?? sampleMessage;
}

function extractCommandFromSuggestion(suggestion: string): string | undefined {
  const doubleQuoted = suggestion.match(/"((?:npx|npm)\s[^"]+)"/i);
  if (doubleQuoted?.[1]) return doubleQuoted[1];

  const backtick = suggestion.match(/`((?:npx|npm)\s[^`]+)`/i);
  if (backtick?.[1]) return backtick[1];

  return undefined;
}

/**
 * Build the group-level remediation hint. Env groups may span multiple packages
 * in a monorepo — include every unique suggestion so Copy fix is complete.
 */
export function aggregateGroupSuggestion(
  key: string,
  suggestions: readonly string[],
): string | undefined {
  const unique = [...new Set(suggestions.map((item) => item.trim()).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b),
  );

  if (key.startsWith('env:')) {
    if (unique.length === 0) {
      return `Add ${key.slice(4)}= to .env.example.`;
    }
    return unique.join('\n');
  }

  return unique[0];
}

const CI_WORKFLOW_HINT =
  'Run "npx assurly init" in your repository to automatically configure the CI/CD pipeline.';

/**
 * The CI nag in today's words, whatever was persisted. Reports leave the app as
 * JSON (MCP, API, shared pages), so the old `npx shipready init` text must not
 * survive even in fields the dashboard does not render.
 */
function canonicalSetupFinding(finding: ShipGateFindingInput): ShipGateFindingInput {
  if (!isCiWorkflowSuggestion(finding)) return finding;
  return {
    ...finding,
    ruleId: 'github-actions-integration',
    message: 'GitHub Actions workflow for Assurly is missing.',
    suggestion: CI_WORKFLOW_HINT,
  };
}

/**
 * Missing RLS on a database no browser can reach, all tables in one group:
 * five identical warnings told the reader nothing five times.
 */
function buildAdvisories(advisory: readonly ShipGateFindingInput[]): ShipGateGroup[] {
  if (advisory.length === 0) return [];
  const tables = [
    ...new Set(
      advisory
        .map((finding) => finding.message.match(/table '([^']+)'/i)?.[1])
        .filter((table): table is string => Boolean(table)),
    ),
  ];
  const files = new Set(advisory.map((finding) => finding.file ?? '__global__'));
  const count = tables.length || advisory.length;
  return [
    {
      id: 'advisory:database-safety-net',
      label: `No row-level safety net in the database · ${count} ${count === 1 ? 'table' : 'tables'}`,
      severity: 'warning',
      occurrenceCount: advisory.length,
      affectedFileCount: files.size,
      sampleMessage:
        'Not a leak: no Supabase or other browser access to this database was found, so only your backend reads these tables. ' +
        'If you ever expose the database to the browser, turn on row-level security with a policy for each table first — ' +
        'turning it on without policies blocks every query your app makes.' +
        (tables.length > 0 ? ` Tables: ${tables.join(', ')}.` : ''),
    },
  ];
}

/**
 * One line per thing the scan could not check. Registry misses are counted,
 * not listed: nineteen identical lines would bury the one that matters.
 */
function buildCoverageNotes(coverage: readonly ShipGateFindingInput[]): string[] {
  const registryMisses = coverage.filter(
    (finding) => finding.ruleId === 'dep-registry-unavailable',
  ).length;
  const notes = coverage
    .filter((finding) => finding.ruleId !== 'dep-registry-unavailable')
    .map((finding) => finding.message);
  if (registryMisses > 0) {
    const packages = registryMisses === 1 ? '1 npm package' : `${registryMisses} npm packages`;
    const pronoun = registryMisses === 1 ? 'it was' : 'they were';
    notes.push(
      `Could not check ${packages} against the registry, so ${pronoun} not checked for lookalike or invented names.`,
    );
  }
  return [...new Set(notes)];
}

export function resolveGroupAction(
  key: string,
  suggestion: string | undefined,
  ruleId: string | undefined,
): ShipGateAction | undefined {
  if (
    key === 'rule:github-actions-integration' ||
    ruleId === 'github-actions-integration' ||
    key.includes('github-actions')
  ) {
    return {
      label: 'Initialize CI workflow',
      kind: 'command',
      command: 'npx assurly init',
      // Never the stored suggestion: scans from before the rename say
      // `npx shipready init`, and that npm package is someone else's.
      hint: CI_WORKFLOW_HINT,
    };
  }

  if (key === 'rule:assurly-canary-missing' || ruleId === 'assurly-canary-missing') {
    return {
      label: 'Add a silent alarm',
      kind: 'link',
      href: '#canary-silent-alarm',
      hint: suggestion ?? 'Add a silent alarm in Assurly (dashboard / MCP plant).',
    };
  }

  if (key.startsWith('env:')) {
    const envName = key.slice(4);
    return {
      label: 'Document the variable',
      kind: 'hint',
      hint: suggestion ?? `Add ${envName}= to .env.example.`,
    };
  }

  if (key.startsWith('rls:')) {
    const table = key.slice(4);
    return {
      label: 'Enable row-level security',
      kind: 'hint',
      hint: suggestion ?? `Enable RLS on table ${table}.`,
    };
  }

  if (key === 'stripe:webhook-signature') {
    return {
      label: 'Verify webhook signatures',
      kind: 'hint',
      hint:
        suggestion ??
        'Verify events with stripe.webhooks.constructEvent before processing the payload.',
    };
  }

  if (key === 'perf:cold-start') {
    return {
      label: 'Reduce bundle size',
      kind: 'hint',
      hint: suggestion,
    };
  }

  if (key === 'rsc:client-import') {
    return {
      label: 'Fix client boundary',
      kind: 'hint',
      hint: suggestion,
    };
  }

  if (key === 'edge:runtime') {
    return {
      label: 'Fix Edge compatibility',
      kind: 'hint',
      hint: suggestion,
    };
  }

  const command = suggestion ? extractCommandFromSuggestion(suggestion) : undefined;
  if (command) {
    return {
      label: 'Run locally',
      kind: 'command',
      command,
      hint: suggestion,
    };
  }

  if (suggestion) {
    return {
      label: 'Suggested fix',
      kind: 'hint',
      hint: suggestion,
    };
  }

  return undefined;
}

function formatActionPlainText(action: ShipGateAction): string {
  switch (action.kind) {
    case 'command':
      return action.command ? `Run: ${action.command}` : action.label;
    case 'link':
      return action.href ? `Docs: ${action.href}` : action.label;
    case 'hint':
      return action.hint ?? action.label;
    default: {
      const neverKind: never = action.kind;
      return neverKind;
    }
  }
}

function formatActionMarkdown(action: ShipGateAction): string {
  switch (action.kind) {
    case 'command':
      return action.command ? `\`${action.command}\`` : action.label;
    case 'link':
      return action.href ? `[${action.label}](${action.href})` : action.label;
    case 'hint':
      return action.hint ?? action.label;
    default: {
      const neverKind: never = action.kind;
      return neverKind;
    }
  }
}

export function buildIssueGroups(findings: ShipGateFindingInput[]): ShipGateGroup[] {
  const groups = new Map<
    string,
    {
      severity: Severity;
      files: Set<string>;
      count: number;
      sampleMessage: string;
      suggestions: string[];
      ruleId?: string;
    }
  >();

  for (const finding of findings) {
    const key = getFindingGroupKey(finding);
    const fileKey = finding.file || '__global__';
    const existing = groups.get(key);
    if (existing) {
      existing.count += 1;
      existing.files.add(fileKey);
      if (finding.severity === 'error') existing.severity = 'error';
      if (finding.suggestion) {
        existing.suggestions.push(finding.suggestion);
      }
    } else {
      groups.set(key, {
        severity: finding.severity === 'error' ? 'error' : 'warning',
        files: new Set([fileKey]),
        count: 1,
        sampleMessage: finding.message || key,
        suggestions: finding.suggestion ? [finding.suggestion] : [],
        ruleId: finding.ruleId,
      });
    }
  }

  return [...groups.entries()]
    .map(([key, value]) => ({
      id: key,
      label: issueGroupLabel(key, value.sampleMessage),
      severity: value.severity,
      occurrenceCount: value.count,
      affectedFileCount: value.files.has('__global__')
        ? value.files.size - (value.files.size > 0 ? 1 : 0) || 1
        : value.files.size,
      sampleMessage: value.sampleMessage,
      action: resolveGroupAction(
        key,
        aggregateGroupSuggestion(key, value.suggestions),
        value.ruleId,
      ),
    }))
    .sort((a, b) => {
      if (a.severity !== b.severity) return a.severity === 'error' ? -1 : 1;
      return b.affectedFileCount - a.affectedFileCount || b.occurrenceCount - a.occurrenceCount;
    });
}

function resolveFileCounts(
  findings: ShipGateFindingInput[],
  options: ShipGateOptions,
): { scannedFileCount: number; cleanFileCount: number } {
  const findingFiles = findings.map((finding) => finding.file);
  const affectedAnalyzedCount = findingFiles.filter(
    (file): file is string => typeof file === 'string' && isAnalyzedCodeFile(file),
  ).length;

  const scannedFileCount =
    options.scannedFileCount ?? Math.max(affectedAnalyzedCount, findings.length > 0 ? 1 : 0);
  const cleanFileCount =
    options.cleanFileCount ?? countCleanScannedFiles(scannedFileCount, findingFiles);

  return { scannedFileCount, cleanFileCount };
}

export function buildShipGateReport(
  findings: ShipGateFindingInput[],
  options: ShipGateOptions = {},
): ShipGateReport {
  // Only problems in the app are scored and listed; see findingKind.
  const issues = findings.filter((finding) => findingKind(finding) === 'issue');
  const coverage = findings.filter((finding) => findingKind(finding) === 'coverage');
  const setupFindings = findings
    .filter((finding) => findingKind(finding) === 'setup')
    .map(canonicalSetupFinding);
  const advisoryFindings = findings.filter((finding) => findingKind(finding) === 'advisory');

  const blockerFindings = issues.filter(isBlockerFinding);
  const reviewFindings = issues.filter(isReviewFinding);
  const warningFindings = issues.filter(isWarningFinding);

  const blockers = buildIssueGroups(blockerFindings);
  const reviews = buildIssueGroups(reviewFindings);
  const warnings = buildIssueGroups(warningFindings);
  const { scannedFileCount, cleanFileCount } = resolveFileCounts(issues, options);

  const hasIncompleteCoverage = findings.some((finding) => finding.ruleId === 'scan-completeness');
  /** Payment or login code in a language Assurly cannot read: never Ready. */
  const hasUnreadSecuritySurface = findings.some(
    (finding) => finding.ruleId === 'scan-language-coverage',
  );

  /** Incomplete browser scans must never look "production ready". */
  const INCOMPLETE_SCORE_CAP = 79;
  /**
   * Instant Gate partial samples can accumulate many warning groups and hit 0.
   * With zero blockers that reads as a dumpster-fire failure, which is not
   * defensible — keep incomplete+unblocked scores in the review band.
   */
  const INCOMPLETE_NO_BLOCKER_FLOOR = 40;

  let shipScore = Math.max(
    0,
    Math.min(
      100,
      100 -
        cappedRlsGroupCount(blockers) * BLOCKER_PENALTY -
        cappedRlsGroupCount(reviews) * WARNING_PENALTY -
        cappedRlsGroupCount(warnings) * WARNING_PENALTY,
    ),
  );

  let status: ShipGateStatus;
  let headline: string;
  let statusEmoji: string;

  if (blockers.length > 0) {
    status = 'blocked';
    headline = 'NOT READY TO SHIP';
    statusEmoji = '🚫';
  } else if (
    warnings.length > 0 ||
    reviews.length > 0 ||
    hasIncompleteCoverage ||
    hasUnreadSecuritySurface
  ) {
    status = 'review';
    // Payment or login code nobody read: no verdict either way, whatever the
    // score of the code that was read.
    headline = hasIncompleteCoverage
      ? 'INCOMPLETE SCAN — REVIEW'
      : hasUnreadSecuritySurface
        ? 'CAN’T CALL IT YET'
        : 'REVIEW RECOMMENDED';
    statusEmoji = '⚠️';
  } else if (options.scannedFileCount === 0) {
    // Explicit empty input (idle folder/ZIP) — never claim READY TO SHIP.
    // Omitted scannedFileCount with zero findings still means a clean completed scan.
    status = 'review';
    headline = 'NO FILES SCANNED';
    statusEmoji = '○';
  } else {
    status = 'ready';
    headline = 'READY TO SHIP';
    statusEmoji = '✅';
  }

  if (hasIncompleteCoverage) {
    shipScore = Math.min(shipScore, INCOMPLETE_SCORE_CAP);
    if (blockers.length === 0) {
      shipScore = Math.max(shipScore, INCOMPLETE_NO_BLOCKER_FLOOR);
    }
  }

  if (status === 'blocked') {
    shipScore = Math.min(shipScore, BLOCKED_SCORE_CAP);
  }

  const resolvedShipScore = options.scannedFileCount === 0 && status !== 'blocked' ? 0 : shipScore;

  return {
    status,
    shipScore: resolvedShipScore,
    headline,
    statusEmoji,
    blockers,
    reviews,
    warnings,
    cleanFileCount,
    scannedFileCount,
    totalErrorFindings: issues.filter((finding) => finding.severity === 'error').length,
    totalWarningFindings: issues.filter(isWarningFinding).length,
    scanScope: options.scanScope,
    coverageNotes: buildCoverageNotes(coverage),
    setup: buildIssueGroups(setupFindings),
    advisories: buildAdvisories(advisoryFindings),
    partialCoverage: hasIncompleteCoverage || hasUnreadSecuritySurface,
  };
}

function formatFileSuffix(count: number): string {
  return `→ ${count} file${count === 1 ? '' : 's'}`;
}

function padLine(left: string, right: string, width = 52): string {
  const gap = Math.max(1, width - left.length);
  return `${left}${' '.repeat(gap)}${right}`;
}

export function formatShipGatePlainText(report: ShipGateReport): string {
  const lines: string[] = [];
  lines.push(
    `${report.statusEmoji} ${report.headline}${padLine('', `Ship Score: ${report.shipScore}/100`, 28)}`,
  );

  if (report.scanScope) {
    lines.push(formatScanScopeSummary(report.scanScope));
  }

  if (report.blockers.length > 0) {
    lines.push('Blockers (must fix):');
    report.blockers.forEach((blocker, index) => {
      lines.push(
        `  ${index + 1}. ${padLine(blocker.label, formatFileSuffix(blocker.affectedFileCount))}`,
      );
      if (blocker.action) {
        lines.push(`     ↳ ${formatActionPlainText(blocker.action)}`);
      }
    });
  }

  if (report.reviews.length > 0) {
    lines.push('Review (heuristic — verify before blocking deploy):');
    report.reviews.forEach((review, index) => {
      lines.push(
        `  ${index + 1}. ${padLine(review.label, formatFileSuffix(review.affectedFileCount))}`,
      );
      if (review.action) {
        lines.push(`     ↳ ${formatActionPlainText(review.action)}`);
      }
    });
  }

  if (report.warnings.length > 0) {
    lines.push('Warnings (review):');
    report.warnings.forEach((warning) => {
      lines.push(`  · ${padLine(warning.label, formatFileSuffix(warning.affectedFileCount))}`);
      if (warning.action) {
        lines.push(`     ↳ ${formatActionPlainText(warning.action)}`);
      }
    });
  }

  const coverageNotes = report.coverageNotes ?? [];
  if (coverageNotes.length > 0) {
    lines.push('Not checked by this scan:');
    coverageNotes.forEach((note) => lines.push(`  · ${note}`));
  }

  const advisories = report.advisories ?? [];
  if (advisories.length > 0) {
    lines.push('Good to know (not scored):');
    advisories.forEach((item) => {
      lines.push(`  · ${item.label}`);
      lines.push(`     ${item.sampleMessage}`);
    });
  }

  const setup = report.setup ?? [];
  if (setup.length > 0) {
    lines.push('Optional setup:');
    setup.forEach((item) => {
      lines.push(`  · ${item.label}`);
      if (item.action) lines.push(`     ↳ ${formatActionPlainText(item.action)}`);
    });
  }

  if (report.cleanFileCount > 0) {
    lines.push(`✓ ${report.cleanFileCount} file${report.cleanFileCount === 1 ? '' : 's'} clean`);
  } else if (report.status === 'ready') {
    lines.push('✓ All scanned files passed with no issues.');
  }

  return lines.join('\n');
}

export interface ShipGateMarkdownOptions {
  repositoryName?: string;
  reportUrl?: string;
}

export function formatShipGateMarkdown(
  report: ShipGateReport,
  options: ShipGateMarkdownOptions = {},
): string {
  const lines: string[] = [];
  const title = `${report.statusEmoji} **${report.headline}** · Ship Score: **${report.shipScore}/100**`;
  lines.push(title);

  if (options.repositoryName) {
    lines.push(`Repository: \`${options.repositoryName}\``);
  }

  if (report.scanScope) {
    lines.push(formatScanScopeSummary(report.scanScope));
  }

  lines.push('');

  if (report.blockers.length > 0) {
    lines.push('#### Blockers (must fix)');
    report.blockers.forEach((blocker, index) => {
      lines.push(
        `${index + 1}. ${blocker.label} → ${blocker.affectedFileCount} file${blocker.affectedFileCount === 1 ? '' : 's'}`,
      );
      if (blocker.action) {
        lines.push(`   - Action: ${formatActionMarkdown(blocker.action)}`);
      }
    });
    lines.push('');
  }

  if (report.reviews.length > 0) {
    lines.push('#### Review (heuristic)');
    report.reviews.forEach((review, index) => {
      lines.push(
        `${index + 1}. ${review.label} → ${review.affectedFileCount} file${review.affectedFileCount === 1 ? '' : 's'}`,
      );
      if (review.action) {
        lines.push(`   - Action: ${formatActionMarkdown(review.action)}`);
      }
    });
    lines.push('');
  }

  if (report.warnings.length > 0) {
    lines.push('#### Warnings (review)');
    report.warnings.forEach((warning) => {
      lines.push(
        `- ${warning.label} → ${warning.affectedFileCount} file${warning.affectedFileCount === 1 ? '' : 's'}`,
      );
      if (warning.action) {
        lines.push(`  - Action: ${formatActionMarkdown(warning.action)}`);
      }
    });
    lines.push('');
  }

  const coverageNotes = report.coverageNotes ?? [];
  if (coverageNotes.length > 0) {
    lines.push('#### Not checked by this scan');
    coverageNotes.forEach((note) => lines.push(`- ${note}`));
    lines.push('');
  }

  const advisories = report.advisories ?? [];
  if (advisories.length > 0) {
    lines.push('#### Good to know (not scored)');
    advisories.forEach((item) => lines.push(`- **${item.label}** — ${item.sampleMessage}`));
    lines.push('');
  }

  const setup = report.setup ?? [];
  if (setup.length > 0) {
    lines.push('#### Optional setup');
    setup.forEach((item) => {
      lines.push(`- ${item.label}`);
      if (item.action) lines.push(`  - Action: ${formatActionMarkdown(item.action)}`);
    });
    lines.push('');
  }

  if (report.cleanFileCount > 0) {
    lines.push(
      `✅ **${report.cleanFileCount}** file${report.cleanFileCount === 1 ? '' : 's'} clean`,
    );
  } else if (report.status === 'ready') {
    lines.push('✅ All scanned files passed with no issues.');
  }

  if (report.totalErrorFindings > 0 || report.totalWarningFindings > 0) {
    lines.push('');
    lines.push(
      `<sub>${report.totalErrorFindings} error finding${report.totalErrorFindings === 1 ? '' : 's'}, ${report.totalWarningFindings} warning finding${report.totalWarningFindings === 1 ? '' : 's'} across ${report.scannedFileCount} scanned file${report.scannedFileCount === 1 ? '' : 's'}.</sub>`,
    );
  }

  if (options.reportUrl) {
    lines.push('');
    lines.push(`[View full Assurly report](${options.reportUrl})`);
  }

  return lines.join('\n');
}

export function isShipGateBlocked(report: ShipGateReport): boolean {
  return report.status === 'blocked';
}
