'use client';

import type { ReactElement } from 'react';
import { CopyButton } from '../../../_components/ship-gate/CopyButton';
import type { WebFinding } from '../../../../utils/browserScanner';
import { buildManualCheckerHandoffPrompt } from './shipHandoff';
import { buildShipReceiptMarkdown } from './shipReceipt';
import type { AppliedManualFix } from './shipLoopTypes';

export interface ShipLoopPanelProps {
  /** When false (e.g. idle project), render nothing. */
  visible: boolean;
  appliedFixes: readonly AppliedManualFix[];
  remainingFindings: readonly WebFinding[];
  shipGateStatus: 'ready' | 'blocked' | 'review' | 'empty';
  shipScore: number;
  blockerCount: number;
  warningCount: number;
  scannedFileCount: number;
  cleanFileCount: number;
  projectName: string;
  mode: 'project' | 'snippet';
  onUndoLast: () => void;
}

export function ShipLoopPanel({
  visible,
  appliedFixes,
  remainingFindings,
  shipGateStatus,
  shipScore,
  blockerCount,
  warningCount,
  scannedFileCount,
  cleanFileCount,
  projectName,
  mode,
  onUndoLast,
}: ShipLoopPanelProps): ReactElement | null {
  if (!visible) return null;

  const showWhatChanged = appliedFixes.length > 0;
  const showHandoff = remainingFindings.length > 0;
  const showReceipt = shipGateStatus === 'ready';

  if (!showWhatChanged && !showHandoff && !showReceipt) {
    return null;
  }

  const handoffValue = buildManualCheckerHandoffPrompt({
    remainingFindings: [...remainingFindings],
    appliedFixes: [...appliedFixes],
    mode,
  });

  const receiptValue = buildShipReceiptMarkdown({
    status: shipGateStatus,
    shipScore,
    blockerCount,
    warningCount,
    scannedFileCount,
    cleanFileCount,
    appliedFixCount: appliedFixes.length,
    projectName,
    generatedAt: new Date().toISOString(),
  });

  const latestFixId = appliedFixes[appliedFixes.length - 1]?.id;

  return (
    <section className="ship-loop-panel" aria-label="Ship Loop">
      {showWhatChanged ? (
        <div className="ship-loop-section" data-testid="ship-loop-what-changed">
          <h4 className="ship-loop-section__title">What changed</h4>
          <p className="ship-loop-section__intro">
            Assurly applied these local fixes. Review in plain language — your source stayed in the
            browser.
          </p>
          <ul className="ship-loop-fix-list">
            {appliedFixes.map((fix) => {
              const isLatest = fix.id === latestFixId;
              return (
                <li key={fix.id} className="ship-loop-fix-card">
                  <div className="ship-loop-fix-card__header">
                    <span className="ship-loop-fix-card__label">{fix.label}</span>
                    {isLatest ? (
                      <button
                        type="button"
                        className="ship-loop-undo-btn"
                        data-testid="ship-loop-undo"
                        onClick={onUndoLast}
                      >
                        Undo
                      </button>
                    ) : null}
                  </div>
                  <p className="ship-loop-fix-card__before">
                    <span className="ship-loop-fix-card__kicker">Before</span>
                    {fix.beforeSummary}
                  </p>
                  <p className="ship-loop-fix-card__after">
                    <span className="ship-loop-fix-card__kicker">After</span>
                    {fix.afterSummary}
                  </p>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}

      {showHandoff ? (
        <div
          className="ship-loop-section ship-loop-section--actions"
          data-testid="ship-loop-handoff"
        >
          <div className="ship-loop-action-copy">
            <h4 className="ship-loop-section__title">Continue in Cursor / Claude</h4>
            <p className="ship-loop-section__intro">
              Copy a paste-ready brief with remaining blockers and what Assurly already fixed.
            </p>
          </div>
          <CopyButton value={handoffValue} label="Continue in Cursor / Claude" />
        </div>
      ) : null}

      {showReceipt ? (
        <div
          className="ship-loop-section ship-loop-section--actions"
          data-testid="ship-loop-receipt"
        >
          <div className="ship-loop-action-copy">
            <h4 className="ship-loop-section__title">Ship Receipt</h4>
            <p className="ship-loop-section__intro">
              Copy a client-safe proof that this scan is READY TO SHIP — metadata only, no source.
            </p>
          </div>
          <CopyButton value={receiptValue} label="Copy Ship Receipt" />
        </div>
      ) : null}
    </section>
  );
}
