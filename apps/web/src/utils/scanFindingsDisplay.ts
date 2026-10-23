import {
  getFindingGroupKey,
  isShipGateBlockerFinding,
  type ShipGateFindingInput,
} from '@assurly/scanner-core';
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

/**
 * Auto-fix operates on a database-persisted finding via /api/github/fix, which
 * requires a real id. Client-generated findings — those from an unsaved local
 * scan, or the in-session overflow beyond the persistence cap — carry a
 * `find-...` id and cannot be fixed; offering the action for them would only
 * fail request validation.
 */
export function isLocalFindingId(id: string): boolean {
  return id.startsWith('find-');
}

/** A saved finding the Ship Gate counts as a blocker: the ones that show their code. */
export function isSavedBlockerFinding(finding: ScanFinding): boolean {
  return (
    !isLocalFindingId(finding.id) &&
    isShipGateBlockerFinding({ ...toShipGateFindingInput(finding), confidence: finding.confidence })
  );
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
