import {
  buildShipGateReport,
  type ShipGateFindingInput,
  type ShipGateOptions,
  type ShipGateReport,
  type ShipGateStatus,
  type Severity,
} from '@assurly/scanner-core';
import type { ScanFinding } from './dbAdapter';
import type { WebFinding } from './browserScanner';

export type { ShipGateReport, ShipGateGroup, ShipGateAction } from '@assurly/scanner-core';
export {
  countCleanScannedFiles,
  formatShipGateMarkdown,
  formatShipGatePlainText,
  isShipGateBlocked,
} from '@assurly/scanner-core';

export function toShipGateFinding(
  finding: Pick<
    WebFinding,
    'severity' | 'confidence' | 'message' | 'file' | 'line' | 'suggestion' | 'ruleId'
  > & {
    /** Back-compat: historically some callers passed the DB snake_case field. */
    rule_id?: string;
  },
): ShipGateFindingInput {
  return {
    severity: finding.severity,
    confidence: finding.confidence,
    message: finding.message,
    file: finding.file,
    line: finding.line,
    // WebFinding carries `ruleId` (camelCase). Reading `rule_id` here silently
    // collapsed every runtime finding into one 'unknown' group, so two distinct
    // warnings (e.g. missing-headers + supabase-key-exposed) merged and the second
    // finding's message/consequence vanished from the Ship Gate breakdown.
    ruleId: finding.ruleId ?? finding.rule_id ?? 'unknown',
    suggestion: finding.suggestion,
  };
}

export function buildShipGateFromWebFindings(
  findings: WebFinding[],
  options?: ShipGateOptions,
): ShipGateReport {
  return buildShipGateReport(findings.map(toShipGateFinding), options);
}

export function buildShipGateFromScanFindings(
  findings: ScanFinding[],
  options?: ShipGateOptions,
): ShipGateReport {
  return buildShipGateReport(
    findings.map((finding) => ({
      severity: finding.severity,
      confidence: finding.confidence,
      message: finding.message,
      file: finding.file_path,
      line: finding.line_number,
      ruleId: finding.rule_id,
      suggestion: finding.suggestion,
    })),
    options,
  );
}

/** The single most important issue behind a verdict — "the one thing that hurts". */
export interface VerdictTopIssue {
  /** Group key (rule-derived) for the dominant issue. */
  key: string;
  label: string;
  severity: Severity;
  sampleMessage: string;
  affectedFileCount: number;
  occurrenceCount: number;
}

/**
 * A compact, always-current safety verdict for one app. This is the projection
 * the dashboard verdict cards, the `targets` table (`verdict_evidence`), and the
 * badge all render from — the answer to "can I ship this right now?" plus the
 * single dominant issue to surface at a glance.
 */
export interface Verdict {
  status: ShipGateStatus;
  shipScore: number;
  headline: string;
  statusEmoji: string;
  blockerCount: number;
  reviewCount: number;
  warningCount: number;
  cleanFileCount: number;
  scannedFileCount: number;
  /** The dominant issue to surface, or `null` when the app is ready to ship. */
  topIssue: VerdictTopIssue | null;
}

/**
 * Collapses a full Ship Gate report into the compact verdict the product leads
 * with. The dominant issue is the highest-priority group: a blocker if any,
 * else a review item, else a warning — mirroring the gate's own precedence.
 */
export function resolveVerdict(report: ShipGateReport): Verdict {
  const topGroup = report.blockers[0] ?? report.reviews[0] ?? report.warnings[0] ?? null;
  return {
    status: report.status,
    shipScore: report.shipScore,
    headline: report.headline,
    statusEmoji: report.statusEmoji,
    blockerCount: report.blockers.length,
    reviewCount: report.reviews.length,
    warningCount: report.warnings.length,
    cleanFileCount: report.cleanFileCount,
    scannedFileCount: report.scannedFileCount,
    topIssue: topGroup
      ? {
          key: topGroup.id,
          label: topGroup.label,
          severity: topGroup.severity,
          sampleMessage: topGroup.sampleMessage,
          affectedFileCount: topGroup.affectedFileCount,
          occurrenceCount: topGroup.occurrenceCount,
        }
      : null,
  };
}

/** Convenience: resolve a verdict straight from persisted scan findings. */
export function resolveVerdictFromScanFindings(
  findings: ScanFinding[],
  options?: ShipGateOptions,
): Verdict {
  return resolveVerdict(buildShipGateFromScanFindings(findings, options));
}

const MAX_NEXT_STEPS = 3;

/**
 * The verdict's to-do list, in the order things block launch: what to fix,
 * then the code nobody could read. A vibecoder reads this before anything else.
 */
export function buildNextSteps(report: ShipGateReport): string[] {
  const groups = [...report.blockers, ...report.reviews, ...report.warnings];
  const steps = groups.slice(0, MAX_NEXT_STEPS).map((group) => group.label);
  const rest = groups.length - steps.length;
  if (rest > 0) steps.push(`…and ${rest} more listed below`);

  const unread = report.partialCoverage ? (report.scanScope?.unanalyzed ?? []) : [];
  if (unread.length > 0) {
    const languages = unread.map((entry) => entry.language);
    const named =
      languages.length === 1
        ? languages[0]
        : `${languages.slice(0, -1).join(', ')} and ${languages[languages.length - 1]}`;
    steps.push(`Have the ${named} code checked by hand: Assurly cannot read it yet`);
  }
  return steps;
}

/** Share of the repository's source files this scan read, or null when unknown. */
export function scanCoveragePercent(report: ShipGateReport): number | null {
  const scope = report.scanScope;
  if (!scope?.sourceTotal || scope.sourceTotal <= 0) return null;
  return Math.min(100, Math.round((scope.scanned / scope.sourceTotal) * 100));
}

export function getShipGateActionHint(
  report: ShipGateReport,
  options?: { surface?: 'repo' | 'manual'; reason?: 'too_large' },
): string {
  if (options?.reason === 'too_large') {
    return 'This repository exceeds Instant Gate limits. Run Full Gate locally or in CI.';
  }

  if (report.scannedFileCount === 0 && report.status !== 'ready') {
    return options?.surface === 'manual'
      ? 'Select a folder or ZIP to start'
      : 'No scannable application files (JS/TS/SQL) were found in this repository.';
  }

  switch (report.status) {
    case 'blocked':
      return 'Fix all blockers above before deploying to production.';
    case 'review':
      if (report.headline.includes('INCOMPLETE')) {
        return 'Coverage is incomplete — run a full local CLI scan before you trust a clean result.';
      }
      if (report.partialCoverage && report.blockers.length === 0) {
        return 'Nothing Assurly read blocks launch. Get the unread code checked before you ship.';
      }
      if (report.blockers.length === 0 && report.reviews.length > 0) {
        return 'No blockers detected. Review heuristic findings and warnings before shipping.';
      }
      return 'No blockers detected. Review warnings before shipping.';
    case 'ready': {
      // Say what was checked, not what it means for the launch: a static read of
      // the code cannot vouch for config, data or anything it did not read.
      const files = report.scannedFileCount;
      return `Nothing in the ${files} ${files === 1 ? 'file' : 'files'} Assurly read blocks launch.`;
    }
    default: {
      const neverStatus: never = report.status;
      return neverStatus;
    }
  }
}
