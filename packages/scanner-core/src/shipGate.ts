import type { FindingConfidence, ScannerFinding, Severity } from './index';
import type { ScanScope } from './fileRelevance';
import { formatScanScopeSummary } from './fileRelevance';

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
}

export interface ShipGateOptions {
  scannedFileCount?: number;
  cleanFileCount?: number;
  scanScope?: ScanScope;
}

const BLOCKER_PENALTY = 12;
const WARNING_PENALTY = 4;

function effectiveConfidence(confidence: FindingConfidence | undefined): FindingConfidence {
  return confidence ?? 'high';
}

function isBlockerFinding(finding: ShipGateFindingInput): boolean {
  return finding.severity === 'error' && effectiveConfidence(finding.confidence) === 'high';
}

function isReviewFinding(finding: ShipGateFindingInput): boolean {
  return finding.severity === 'error' && effectiveConfidence(finding.confidence) !== 'high';
}

function isWarningFinding(finding: ShipGateFindingInput): boolean {
  return finding.severity === 'warning';
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
  if (message.includes('github actions workflow') && message.includes('shipready')) {
    return 'rule:github-actions-integration';
  }

  if (finding.ruleId) return `rule:${finding.ruleId}`;

  return `msg:${message.replace(/\s+/g, ' ').trim()}`;
}

function issueGroupLabel(key: string, sampleMessage: string): string {
  if (key.startsWith('env:')) {
    return `Undocumented env: ${key.slice(4)}`;
  }
  if (key.startsWith('rls:')) {
    return `Missing RLS on table: ${key.slice(4)}`;
  }
  if (key === 'stripe:webhook-signature') return 'Stripe webhook signature missing';
  if (key === 'rsc:client-import') return 'Client component imports server module';
  if (key === 'perf:cold-start') return 'Heavy serverless / cold-start risk';
  if (key === 'edge:runtime') return 'Edge runtime compatibility';
  return sampleMessage.length > 72 ? `${sampleMessage.slice(0, 69)}…` : sampleMessage;
}

function extractCommandFromSuggestion(suggestion: string): string | undefined {
  const doubleQuoted = suggestion.match(/"((?:npx|npm)\s[^"]+)"/i);
  if (doubleQuoted?.[1]) return doubleQuoted[1];

  const backtick = suggestion.match(/`((?:npx|npm)\s[^`]+)`/i);
  if (backtick?.[1]) return backtick[1];

  return undefined;
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
      command: 'npx shipready init',
      hint: suggestion,
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
      sampleSuggestion?: string;
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
      if (!existing.sampleSuggestion && finding.suggestion) {
        existing.sampleSuggestion = finding.suggestion;
      }
    } else {
      groups.set(key, {
        severity: finding.severity === 'error' ? 'error' : 'warning',
        files: new Set([fileKey]),
        count: 1,
        sampleMessage: finding.message || key,
        sampleSuggestion: finding.suggestion,
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
      action: resolveGroupAction(key, value.sampleSuggestion, value.ruleId),
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
  const affectedPaths = new Set(
    findings.map((finding) => finding.file).filter((file): file is string => Boolean(file)),
  );

  const scannedFileCount =
    options.scannedFileCount ?? Math.max(affectedPaths.size, findings.length > 0 ? 1 : 0);
  const cleanFileCount =
    options.cleanFileCount ?? Math.max(0, scannedFileCount - affectedPaths.size);

  return { scannedFileCount, cleanFileCount };
}

export function buildShipGateReport(
  findings: ShipGateFindingInput[],
  options: ShipGateOptions = {},
): ShipGateReport {
  const blockerFindings = findings.filter(isBlockerFinding);
  const reviewFindings = findings.filter(isReviewFinding);
  const warningFindings = findings.filter(isWarningFinding);

  const blockers = buildIssueGroups(blockerFindings);
  const reviews = buildIssueGroups(reviewFindings);
  const warnings = buildIssueGroups(warningFindings);
  const { scannedFileCount, cleanFileCount } = resolveFileCounts(findings, options);

  const shipScore = Math.max(
    0,
    Math.min(
      100,
      100 -
        blockers.length * BLOCKER_PENALTY -
        reviews.length * WARNING_PENALTY -
        warnings.length * WARNING_PENALTY,
    ),
  );

  let status: ShipGateStatus;
  let headline: string;
  let statusEmoji: string;

  if (blockers.length > 0) {
    status = 'blocked';
    headline = 'NOT READY TO SHIP';
    statusEmoji = '🚫';
  } else if (warnings.length > 0 || reviews.length > 0) {
    status = 'review';
    headline = 'REVIEW RECOMMENDED';
    statusEmoji = '⚠️';
  } else {
    status = 'ready';
    headline = 'READY TO SHIP';
    statusEmoji = '✅';
  }

  return {
    status,
    shipScore,
    headline,
    statusEmoji,
    blockers,
    reviews,
    warnings,
    cleanFileCount,
    scannedFileCount,
    totalErrorFindings: findings.filter((finding) => finding.severity === 'error').length,
    totalWarningFindings: findings.filter((finding) => finding.severity === 'warning').length,
    scanScope: options.scanScope,
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
    lines.push(`[View full ShipReady report](${options.reportUrl})`);
  }

  return lines.join('\n');
}

export function isShipGateBlocked(report: ShipGateReport): boolean {
  return report.status === 'blocked';
}
