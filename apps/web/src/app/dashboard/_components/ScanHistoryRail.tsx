'use client';

import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import type { Scan } from '../../../utils/dbAdapter';
import { useAccessibleMenu } from '../../../hooks/useAccessibleMenu';
import {
  formatCommitShaShort,
  formatScanDateTime,
  visibleScanHistory,
} from '../../../utils/scanHistoryDisplay';
import {
  readRailOverflow,
  SCAN_HISTORY_RAIL_EDGE_INSET,
  type RailOverflow,
} from './scanHistoryRailOverflow';

export interface ScanHistoryRailProps {
  scans: Scan[];
  selectedScanId: string | null;
  onSelectScan: (scan: Scan) => void;
  /** When provided, each chip gets a delete control gated by a confirm dialog. */
  onDeleteScan?: (scan: Scan) => void;
}

const NO_RAIL_OVERFLOW: RailOverflow = { start: false, end: false };

function overflowOnAxis(
  chipStart: number,
  chipEnd: number,
  railStart: number,
  railEnd: number,
  inset: number,
): number {
  if (chipStart < railStart) {
    return chipStart - (railStart + inset);
  }
  if (chipEnd > railEnd) {
    return chipEnd - (railEnd - inset);
  }
  return 0;
}

export function ScanHistoryRail({
  scans,
  selectedScanId,
  onSelectScan,
  onDeleteScan,
}: ScanHistoryRailProps): ReactElement {
  const chipRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  const railRef = useRef<HTMLDivElement>(null);
  const visibleScans = useMemo(() => visibleScanHistory(scans), [scans]);
  const [overflow, setOverflow] = useState<RailOverflow>(NO_RAIL_OVERFLOW);

  // The scan awaiting an explicit delete confirmation, or null when the dialog
  // is closed. Only ever one dialog open at a time, so a single piece of state
  // and a single accessible-dialog instance cover every chip.
  const [confirmScan, setConfirmScan] = useState<Scan | null>(null);
  const { menuRef: dialogRef, rememberTrigger } = useAccessibleMenu<HTMLDivElement>({
    open: confirmScan !== null,
    onClose: () => setConfirmScan(null),
  });

  useEffect(() => {
    const rail = railRef.current;
    if (!rail) {
      return;
    }

    const updateOverflow = (): void => {
      setOverflow(readRailOverflow(rail));
    };

    updateOverflow();
    rail.addEventListener('scroll', updateOverflow, { passive: true });
    const observer =
      typeof ResizeObserver === 'function' ? new ResizeObserver(updateOverflow) : null;
    observer?.observe(rail);

    return () => {
      rail.removeEventListener('scroll', updateOverflow);
      observer?.disconnect();
    };
  }, [visibleScans]);

  useEffect(() => {
    if (!selectedScanId) {
      return;
    }

    const activeChip = chipRefs.current.get(selectedScanId);
    const rail = railRef.current;
    if (!activeChip || !rail || typeof rail.scrollBy !== 'function') {
      return;
    }

    // Reveal the active chip inside the rail only — horizontally on desktop,
    // vertically in the compact stacked list. `scrollIntoView` would also
    // scroll the page down to the workspace.
    const railRect = rail.getBoundingClientRect();
    const chipRect = activeChip.getBoundingClientRect();
    const left = overflowOnAxis(
      chipRect.left,
      chipRect.right,
      railRect.left,
      railRect.right,
      SCAN_HISTORY_RAIL_EDGE_INSET,
    );
    const top = overflowOnAxis(
      chipRect.top,
      chipRect.bottom,
      railRect.top,
      railRect.bottom,
      SCAN_HISTORY_RAIL_EDGE_INSET,
    );
    if (left !== 0 || top !== 0) {
      rail.scrollBy({ left, top, behavior: 'smooth' });
    }
  }, [selectedScanId, visibleScans]);

  const openConfirm = (scan: Scan, trigger: HTMLButtonElement): void => {
    // Remember the "×" so focus returns to it when the dialog closes.
    rememberTrigger(trigger);
    setConfirmScan(scan);
  };

  const confirmDelete = (): void => {
    if (confirmScan) {
      onDeleteScan?.(confirmScan);
    }
    setConfirmScan(null);
  };

  return (
    <section
      className="scan-history"
      data-testid="scan-history-rail"
      aria-label={`Scan history, ${visibleScans.length} scans`}
    >
      <h3 className="scan-history__heading">Scan history ({visibleScans.length})</h3>
      <div
        className="scan-history-rail-viewport"
        data-overflow-start={overflow.start ? 'true' : undefined}
        data-overflow-end={overflow.end ? 'true' : undefined}
      >
        <div
          ref={railRef}
          className="scan-history-rail"
          // Not a tablist. `role="tablist"` may only own `tab` children, and each
          // item here also carries a delete button — axe reports that as a
          // critical violation. The rail never implemented the tab contract
          // either: no arrow-key roving focus, no `aria-controls` to a tabpanel.
          // A list of scans is what this actually is, and `aria-current` marks the
          // selected one without promising keyboard behaviour that does not exist.
          role="list"
          aria-label="Select a scan"
        >
          {visibleScans.map((scan) => {
            const isSelected = selectedScanId === scan.id;

            return (
              <div key={scan.id} className="scan-history-rail__item" role="listitem">
                <button
                  ref={(element) => {
                    if (element) {
                      chipRefs.current.set(scan.id, element);
                      return;
                    }
                    chipRefs.current.delete(scan.id);
                  }}
                  type="button"
                  aria-current={isSelected ? 'true' : undefined}
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
                    <span className="scan-history-rail__commit">
                      commit {formatCommitShaShort(scan.commit_sha)}
                    </span>
                    <span className="scan-history-rail__sep" aria-hidden="true">
                      {' '}
                      ·{' '}
                    </span>
                    <time className="scan-history-rail__when" dateTime={scan.created_at}>
                      {formatScanDateTime(scan.created_at)}
                    </time>
                  </span>
                </button>

                {onDeleteScan ? (
                  <button
                    type="button"
                    className="scan-history-rail__delete"
                    data-testid={`scan-history-delete-${scan.id}`}
                    aria-label={`Delete the scan of commit ${formatCommitShaShort(
                      scan.commit_sha,
                    )} from ${formatScanDateTime(scan.created_at)}`}
                    onClick={(event) => openConfirm(scan, event.currentTarget)}
                  >
                    <span aria-hidden="true">×</span>
                  </button>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>

      {confirmScan ? (
        <div
          className="scan-delete-dialog__backdrop"
          data-testid="scan-delete-dialog"
          onClick={() => setConfirmScan(null)}
        >
          <div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="scan-delete-dialog-title"
            aria-describedby="scan-delete-dialog-desc"
            className="scan-delete-dialog"
            onClick={(event) => event.stopPropagation()}
          >
            <h4 id="scan-delete-dialog-title" className="scan-delete-dialog__title">
              Delete scan?
            </h4>
            <p id="scan-delete-dialog-desc" className="scan-delete-dialog__desc">
              Delete the scan of commit {formatCommitShaShort(confirmScan.commit_sha)} from{' '}
              {formatScanDateTime(confirmScan.created_at)}? This permanently removes it and its
              findings.
            </p>
            <div className="scan-delete-dialog__actions">
              <button
                type="button"
                className="scan-delete-dialog__cancel"
                onClick={() => setConfirmScan(null)}
              >
                Cancel
              </button>
              <button type="button" className="scan-delete-dialog__confirm" onClick={confirmDelete}>
                Delete scan
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
