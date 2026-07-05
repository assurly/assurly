import {
  buildShipGateReport,
  type ShipGateFindingInput,
  type ShipGateOptions,
  type ShipGateReport,
} from '@shipready/scanner-core';
import type { ScanFinding } from './dbAdapter';
import type { WebFinding } from './browserScanner';

export type { ShipGateReport, ShipGateGroup, ShipGateAction } from '@shipready/scanner-core';
export {
  formatShipGateMarkdown,
  formatShipGatePlainText,
  isShipGateBlocked,
} from '@shipready/scanner-core';

export function toShipGateFinding(
  finding: Pick<WebFinding, 'severity' | 'message' | 'file' | 'line' | 'suggestion'> & {
    rule_id?: string;
  },
): ShipGateFindingInput {
  return {
    severity: finding.severity,
    message: finding.message,
    file: finding.file,
    line: finding.line,
    ruleId: finding.rule_id ?? 'unknown',
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
      message: finding.message,
      file: finding.file_path,
      line: finding.line_number,
      ruleId: finding.rule_id,
      suggestion: finding.suggestion,
    })),
    options,
  );
}

export function getShipGateActionHint(report: ShipGateReport): string {
  switch (report.status) {
    case 'blocked':
      return 'Fix all blockers above before deploying to production.';
    case 'review':
      if (report.blockers.length === 0 && report.reviews.length > 0) {
        return 'No blockers detected. Review heuristic findings and warnings before shipping.';
      }
      return 'No blockers detected. Review warnings before shipping.';
    case 'ready':
      return 'All scanned files passed. You can deploy with confidence.';
    default: {
      const neverStatus: never = report.status;
      return neverStatus;
    }
  }
}
