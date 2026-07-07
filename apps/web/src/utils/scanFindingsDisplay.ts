import { getFindingGroupKey, type ShipGateFindingInput } from '@assurly/scanner-core';
import type { ScanFinding } from './dbAdapter';

export interface DisplayScanFinding extends ScanFinding {
  occurrenceCount: number;
}

function toShipGateFindingInput(finding: ScanFinding): ShipGateFindingInput {
  return {
    severity: finding.severity,
    message: finding.message,
    file: finding.file_path,
    line: finding.line_number,
    ruleId: finding.rule_id,
    suggestion: finding.suggestion,
  };
}

export function dedupeScanFindingsForDisplay(findings: ScanFinding[]): DisplayScanFinding[] {
  const groups = new Map<string, DisplayScanFinding>();

  for (const finding of findings) {
    const key = getFindingGroupKey(toShipGateFindingInput(finding));
    const existing = groups.get(key);

    if (existing) {
      existing.occurrenceCount += 1;
      continue;
    }

    groups.set(key, {
      ...finding,
      occurrenceCount: 1,
    });
  }

  return [...groups.values()];
}
