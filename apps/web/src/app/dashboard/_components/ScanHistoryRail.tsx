'use client';

import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import type { Scan } from '../../../utils/dbAdapter';
import { useAccessibleMenu } from '../../../hooks/useAccessibleMenu';
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
  /** When provided, each chip gets a delete control gated by a confirm dialog. */
  onDeleteScan?: (scan: Scan) => void;
}

export function ScanHistoryRail({
  scans,
  selectedScanId,
  onSelectScan,
  onDeleteScan,
}: ScanHistoryRailProps): ReactElement {
  const chipRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  const railRef = useRef<HTMLDivElement>(null);
  const duplicateBadges = useMemo(() => buildDuplicateShaBadges(scans), [scans]);

  // The scan awaiting an explicit delete confirmation, or null when the dialog
  // is closed. Only ever one dialog open at a time, so a single piece of state
  // and a single accessible-dialog instance cover every chip.
  const [confirmScan, setConfirmScan] = useState<Scan | null>(null);
  const { menuRef: dialogRef, rememberTrigger } = useAccessibleMenu<HTMLDivElement>({
    open: confirmScan !== null,
    onClose: () => setConfirmScan(null),
  });

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
      aria-label={`Scan history, ${scans.length} scans`}
    >
      <h3 className="scan-history__heading">Scan history ({scans.length})</h3>
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
        aria-label="Select scan by commit"
      >
        {scans.map((scan) => {
          const isSelected = selectedScanId === scan.id;
          const duplicateBadge = duplicateBadges.get(scan.id);

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
                  commit {formatCommitShaShort(scan.commit_sha)} ·{' '}
                  <time dateTime={scan.created_at}>{formatScanTime(scan.created_at)}</time>
                </span>
                {duplicateBadge ? (
                  <span className="scan-history-rail__duplicate">
                    {formatDuplicateShaBadge(duplicateBadge)}
                  </span>
                ) : null}
              </button>

              {onDeleteScan ? (
                <button
                  type="button"
                  className="scan-history-rail__delete"
                  data-testid={`scan-history-delete-${scan.id}`}
                  aria-label={`Delete the scan of commit ${formatCommitShaShort(
                    scan.commit_sha,
                  )} from ${formatScanTime(scan.created_at)}`}
                  onClick={(event) => openConfirm(scan, event.currentTarget)}
                >
                  <span aria-hidden="true">×</span>
                </button>
              ) : null}
            </div>
          );
        })}
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
              {formatScanTime(confirmScan.created_at)}? This permanently removes it and its
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
