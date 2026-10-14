import type { Scan, ScanFinding } from './dbAdapter';
import { buildShipGateFromScanFindings, type ShipGateReport } from './shipGate';
import { sortScansNewestFirst } from './scanHistoryDisplay';

export interface ResolvedSincePrevious {
  /** Short commit of the scan being compared against. */
  previousCommit: string;
  /** Problems the previous commit had and this one no longer has. */
  labels: string[];
}

/**
 * The scan to compare against: the newest earlier successful scan of the same
 * branch at a different commit. A rescan of the same commit can only differ
 * because Assurly's rules changed, and crediting that as the user's fix would
 * be a lie; a failed or capped scan holds only part of its findings.
 */
export function pickPreviousScan(scans: readonly Scan[], selected: Scan): Scan | null {
  const ordered = sortScansNewestFirst([...scans]);
  const index = ordered.findIndex((scan) => scan.id === selected.id);
  if (index === -1) return null;
  return (
    ordered
      .slice(index + 1)
      .find(
        (scan) =>
          scan.status === 'success' &&
          scan.branch === selected.branch &&
          scan.commit_sha !== selected.commit_sha,
      ) ?? null
  );
}

function problemGroups(report: ShipGateReport): Map<string, string> {
  return new Map(
    [...report.blockers, ...report.reviews, ...report.warnings].map((group) => [
      group.id,
      group.label,
    ]),
  );
}

/**
 * Problems reported at the previous commit and gone at this one. Both sides go
 * through today's Ship Gate, so a rule that changed since then counts the same
 * way on both and is not mistaken for a fix.
 */
export function findResolvedSincePrevious(
  previous: Scan,
  previousFindings: readonly ScanFinding[],
  currentFindings: readonly ScanFinding[],
): ResolvedSincePrevious | null {
  const before = problemGroups(buildShipGateFromScanFindings([...previousFindings]));
  const now = problemGroups(buildShipGateFromScanFindings([...currentFindings]));
  const labels = [...before.entries()].filter(([id]) => !now.has(id)).map(([, label]) => label);
  if (labels.length === 0) return null;
  return { previousCommit: previous.commit_sha.slice(0, 7), labels };
}
