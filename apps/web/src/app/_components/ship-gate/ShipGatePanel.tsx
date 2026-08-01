'use client';

import type { ReactElement } from 'react';
import { formatScanScopeSummary } from '../../../utils/browserScanner';
import type { ShipGateReport } from '../../../utils/shipGate';
import { getShipGateActionHint } from '../../../utils/shipGate';
import type { BillingPlan } from '../../../utils/entitlements';
import { ShipGateGroupRow } from './ShipGateGroupRow';

/** The plan values this panel renders for. Kept aligned with the canonical enum. */
export type ShipGateBillingPlan = BillingPlan;

interface ShipGatePanelProps {
  report: ShipGateReport;
  actionHint?: string;
  compact?: boolean;
  billingPlan?: ShipGateBillingPlan;
  shareUrl?: string | null;
  badgeMarkdown?: string | null;
  onShare?: () => void;
  isSharing?: boolean;
  shareError?: string | null;
  /** When true, hides the blocker/warning finding details entirely (not just
   *  visually) — used for anonymous, pre-sign-in previews where only the
   *  verdict and score should be free. */
  redactFindings?: boolean;
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
  badgeMarkdown = null,
  onShare,
  isSharing = false,
  shareError = null,
  redactFindings = false,
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

      {report.scanScope ? (
        <p className="ship-gate-scope" role="status">
          {formatScanScopeSummary(report.scanScope)}
        </p>
      ) : null}

      {!redactFindings &&
        (report.blockers.length > 0 || report.reviews.length > 0 || report.warnings.length > 0) && (
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

            {report.reviews.length > 0 ? (
              <div className="ship-gate-group ship-gate-group--reviews">
                <h4 className="ship-gate-group-title">Review (heuristic)</h4>
                <ol className="ship-gate-list">
                  {report.reviews.map((review) => (
                    <ShipGateGroupRow
                      key={review.id}
                      group={review}
                      fileSuffix={fileSuffix(review.affectedFileCount)}
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

      {redactFindings &&
      (report.blockers.length > 0 || report.reviews.length > 0 || report.warnings.length > 0) ? (
        <p className="ship-gate-redacted-hint" data-testid="ship-gate-redacted-hint">
          Sign in to see exactly which files and lines are affected.
        </p>
      ) : null}

      <div className="ship-gate-footer">
        {report.scannedFileCount === 0 ? null : report.cleanFileCount > 0 ? (
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

        {(onShare || shareUrl || badgeMarkdown) && (
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
            {badgeMarkdown ? (
              <div className="ship-gate-share-link">
                <label className="ship-gate-share-label" htmlFor="ship-gate-badge-markdown">
                  README badge
                </label>
                <div className="ship-gate-share-row">
                  <input
                    id="ship-gate-badge-markdown"
                    className="ship-gate-share-input"
                    readOnly
                    value={badgeMarkdown}
                    aria-label="Ship Score badge markdown snippet"
                  />
                  <button
                    type="button"
                    className="ship-gate-share-copy"
                    onClick={() => void navigator.clipboard.writeText(badgeMarkdown)}
                  >
                    Copy badge
                  </button>
                </div>
              </div>
            ) : null}
            {shareError ? <p className="ship-gate-share-error">{shareError}</p> : null}
          </div>
        )}
      </div>
    </section>
  );
}
