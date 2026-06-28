'use client';

import type { ReactElement } from 'react';
import type { ShipGateReport } from '../../../utils/shipGate';
import { getShipGateActionHint } from '../../../utils/shipGate';
import { ShipGateGroupRow } from './ShipGateGroupRow';

export type ShipGateBillingPlan = 'free' | 'pro' | 'agency';

interface ShipGatePanelProps {
  report: ShipGateReport;
  actionHint?: string;
  compact?: boolean;
  billingPlan?: ShipGateBillingPlan;
  shareUrl?: string | null;
  onShare?: () => void;
  isSharing?: boolean;
  shareError?: string | null;
}

function fileSuffix(count: number): string {
  return `→ ${count} file${count === 1 ? '' : 's'}`;
}

export function getShareReportButtonLabel(
  billingPlan: ShipGateBillingPlan | undefined,
  isSharing: boolean,
): string {
  if (isSharing) {
    return 'Creating link…';
  }
  return billingPlan === 'pro' ? 'Share report' : 'Share report (Pro)';
}

export function ShipGatePanel({
  report,
  actionHint,
  compact = false,
  billingPlan,
  shareUrl = null,
  onShare,
  isSharing = false,
  shareError = null,
}: ShipGatePanelProps): ReactElement {
  const hint = actionHint ?? getShipGateActionHint(report);

  return (
    <section
      className={`ship-gate-panel ship-gate-${report.status}${compact ? ' ship-gate-panel--compact' : ''}`}
      aria-label="Ship Gate readiness summary"
    >
      <p className="ship-gate-eyebrow">Ship Gate</p>
      <div className="ship-gate-header">
        <div className="ship-gate-status">
          <span className="ship-gate-emoji" aria-hidden="true">
            {report.statusEmoji}
          </span>
          <span className="ship-gate-headline">{report.headline}</span>
        </div>
        <div className="ship-gate-score" aria-label={`Ship score ${report.shipScore} out of 100`}>
          <span className="ship-gate-score-label">Ship Score</span>
          <strong className="ship-gate-score-value">{report.shipScore}/100</strong>
        </div>
      </div>

      {(report.blockers.length > 0 || report.warnings.length > 0) && (
        <div className="ship-gate-groups">
          {report.blockers.length > 0 ? (
            <div className="ship-gate-group ship-gate-group--blockers">
              <h4 className="ship-gate-group-title">Blockers (must fix)</h4>
              <ol className="ship-gate-list">
                {report.blockers.map((blocker) => (
                  <ShipGateGroupRow
                    key={blocker.id}
                    group={blocker}
                    fileSuffix={fileSuffix(blocker.affectedFileCount)}
                  />
                ))}
              </ol>
            </div>
          ) : null}

          {report.warnings.length > 0 ? (
            <div className="ship-gate-group ship-gate-group--warnings">
              <h4 className="ship-gate-group-title">Warnings (review)</h4>
              <ul className="ship-gate-list ship-gate-list--warnings">
                {report.warnings.map((warning) => (
                  <ShipGateGroupRow
                    key={warning.id}
                    group={warning}
                    fileSuffix={fileSuffix(warning.affectedFileCount)}
                  />
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      )}

      <div className="ship-gate-footer">
        {report.cleanFileCount > 0 ? (
          <p className="ship-gate-clean" role="status">
            <span aria-hidden="true">✓</span>
            {report.cleanFileCount} file{report.cleanFileCount === 1 ? '' : 's'} clean
          </p>
        ) : report.status === 'ready' ? (
          <p className="ship-gate-clean" role="status">
            <span aria-hidden="true">✓</span>
            All scanned files passed with no issues.
          </p>
        ) : null}

        <p className="ship-gate-hint">{hint}</p>

        {(onShare || shareUrl) && (
          <div className="ship-gate-share">
            {shareUrl ? (
              <div className="ship-gate-share-link">
                <label className="ship-gate-share-label" htmlFor="ship-gate-share-url">
                  Shareable report
                </label>
                <div className="ship-gate-share-row">
                  <input
                    id="ship-gate-share-url"
                    className="ship-gate-share-input"
                    readOnly
                    value={shareUrl}
                    aria-label="Shareable report URL"
                  />
                  <button
                    type="button"
                    className="ship-gate-share-copy"
                    onClick={() => void navigator.clipboard.writeText(shareUrl)}
                  >
                    Copy link
                  </button>
                </div>
              </div>
            ) : onShare ? (
              <button
                type="button"
                className="ship-gate-share-btn"
                onClick={onShare}
                disabled={isSharing}
                aria-busy={isSharing}
              >
                {getShareReportButtonLabel(billingPlan, isSharing)}
              </button>
            ) : null}
            {shareError ? <p className="ship-gate-share-error">{shareError}</p> : null}
          </div>
        )}
      </div>
    </section>
  );
}
