'use client';

import { useEffect, useMemo, useRef, type ReactElement } from 'react';
import type { Scan } from '../../../utils/dbAdapter';
import {
  buildDuplicateShaBadges,
  formatCommitShaShort,
  formatDuplicateShaBadge,
  formatScanTime,
} from '../../../utils/scanHistoryDisplay';

export interface ScanHistoryRailProps {
  scans: Scan[];
  selectedScanId: string | null;
  onSelectScan: (scan: Scan) => void;
}

export function ScanHistoryRail({
  scans,
  selectedScanId,
  onSelectScan,
}: ScanHistoryRailProps): ReactElement {
  const chipRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  const railRef = useRef<HTMLDivElement>(null);
  const duplicateBadges = useMemo(() => buildDuplicateShaBadges(scans), [scans]);

  useEffect(() => {
    if (!selectedScanId) {
      return;
    }

    const activeChip = chipRefs.current.get(selectedScanId);
    const rail = railRef.current;
    if (!activeChip || !rail || typeof rail.scrollBy !== 'function') {
      return;
    }

    // Reveal the active chip HORIZONTALLY inside the rail only. `scrollIntoView`
    // would also scroll the whole page vertically to the chip — jerking the user
    // down to the middle of the scan workspace. Scrolling the rail's own overflow
    // keeps the page position untouched.
    const railRect = rail.getBoundingClientRect();
    const chipRect = activeChip.getBoundingClientRect();
    const overflowLeft = chipRect.left - railRect.left;
    const overflowRight = chipRect.right - railRect.right;
    if (overflowLeft < 0) {
      rail.scrollBy({ left: overflowLeft - 8, behavior: 'smooth' });
    } else if (overflowRight > 0) {
      rail.scrollBy({ left: overflowRight + 8, behavior: 'smooth' });
    }
  }, [selectedScanId, scans]);

  return (
    <section
      className="scan-history"
      data-testid="scan-history-rail"
      aria-label={`Scan history, ${scans.length} scans`}
    >
      <h3 className="scan-history__heading">Scan history ({scans.length})</h3>
      <div
        ref={railRef}
        className="scan-history-rail"
        role="tablist"
        aria-label="Select scan by commit"
      >
        {scans.map((scan) => {
          const isSelected = selectedScanId === scan.id;
          const duplicateBadge = duplicateBadges.get(scan.id);

          return (
            <button
              key={scan.id}
              ref={(element) => {
                if (element) {
                  chipRefs.current.set(scan.id, element);
                  return;
                }
                chipRefs.current.delete(scan.id);
              }}
              type="button"
              role="tab"
              aria-selected={isSelected}
              data-testid={`scan-history-chip-${scan.id}`}
              className={[
                'scan-history-rail__chip',
                isSelected ? 'scan-history-rail__chip--active' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              onClick={() => onSelectScan(scan)}
            >
              <span
                className={`scan-history-rail__status scan-history-rail__status--${scan.status}`}
                aria-hidden="true"
              />
              <span className="scan-history-rail__label">
                commit {formatCommitShaShort(scan.commit_sha)} ·{' '}
                <time dateTime={scan.created_at} suppressHydrationWarning>
                  {formatScanTime(scan.created_at)}
                </time>
              </span>
              {duplicateBadge ? (
                <span className="scan-history-rail__duplicate">
                  {formatDuplicateShaBadge(duplicateBadge)}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
    </section>
  );
}
