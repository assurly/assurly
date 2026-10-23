'use client';

import type { ReactElement } from 'react';
import { formatScanScopeSummary } from '../../../utils/browserScanner';
import type { ShipGateReport } from '../../../utils/shipGate';
import {
  buildNextSteps,
  getShipGateActionHint,
  scanCoveragePercent,
} from '../../../utils/shipGate';
import type { BillingPlan } from '../../../utils/entitlements';
import { formatCount } from '../../../utils/pluralize';
import { ShipGateGroupRow } from './ShipGateGroupRow';
import { StopSharingButton } from './StopSharingButton';

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
  /** Revokes the share link; the control is hidden when omitted. */
  onStopSharing?: () => void;
  isStoppingShare?: boolean;
  /** When true, hides the blocker/warning finding details entirely (not just
   *  visually) — used for anonymous, pre-sign-in previews where only the
   *  verdict and score should be free. */
  redactFindings?: boolean;
  /** Problems the previous commit had and this one no longer has. */
  resolvedSincePrevious?: { previousCommit: string; labels: readonly string[] } | null;
}

function fileSuffix(count: number): string {
  return `→ ${formatCount(count, 'file')}`;
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
  onStopSharing,
  isStoppingShare = false,
  redactFindings = false,
  resolvedSincePrevious = null,
}: ShipGatePanelProps): ReactElement {
  const hint = actionHint ?? getShipGateActionHint(report);
  const coverageNotes = report.coverageNotes ?? [];
  const setup = report.setup ?? [];
  const advisories = report.advisories ?? [];
  const nextSteps = redactFindings ? [] : buildNextSteps(report);
  const coveragePercent = scanCoveragePercent(report);
  // Part of the app was not read: the score speaks for the checked part only.
  const scoreLabel = report.partialCoverage ? 'Ship Score · checked part' : 'Ship Score';

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
        <div
          className="ship-gate-score"
          aria-label={`Ship score ${report.shipScore} out of 100${report.partialCoverage ? ' for the checked part' : ''}`}
        >
          <span className="ship-gate-score-label">{scoreLabel}</span>
          <strong className="ship-gate-score-value">{report.shipScore}/100</strong>
        </div>
      </div>

      {report.scanScope ? (
        <div className="ship-gate-coverage">
          {coveragePercent !== null && coveragePercent < 100 ? (
            <div
              className="ship-gate-coverage-meter"
              role="img"
              aria-label={`${coveragePercent} percent of source files checked`}
            >
              <span
                className="ship-gate-coverage-meter__fill"
                style={{ width: `${coveragePercent}%` }}
              />
            </div>
          ) : null}
          <p className="ship-gate-scope" role="status">
            {coveragePercent !== null && coveragePercent < 100
              ? `${coveragePercent}% checked · `
              : ''}
            {formatScanScopeSummary(report.scanScope)}
          </p>
        </div>
      ) : null}

      {!redactFindings && resolvedSincePrevious && resolvedSincePrevious.labels.length > 0 ? (
        <div className="ship-gate-group ship-gate-group--resolved" data-testid="ship-gate-resolved">
          <h4 className="ship-gate-group-title">
            No longer found since commit {resolvedSincePrevious.previousCommit}
          </h4>
          <ul className="ship-gate-list">
            {resolvedSincePrevious.labels.map((label) => (
              <li key={label} className="ship-gate-list-item ship-gate-resolved-item">
                <span aria-hidden="true">✓</span> {label}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {nextSteps.length > 0 ? (
        <div className="ship-gate-next-steps" data-testid="ship-gate-next-steps">
          <h4 className="ship-gate-group-title">Next steps</h4>
          <ol className="ship-gate-next-steps__list">
            {nextSteps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
        </div>
      ) : null}

      {!redactFindings &&
        (report.blockers.length > 0 || report.reviews.length > 0 || report.warnings.length > 0) && (
          <div className="ship-gate-groups">
            {report.blockers.length > 0 ? (
              <div className="ship-gate-group ship-gate-group--blockers">
                <h4 className="ship-gate-group-title">Blocks launch</h4>
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
                <h4 className="ship-gate-group-title">Check before launch</h4>
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
                <h4 className="ship-gate-group-title">Fix before launch</h4>
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

      {!redactFindings && coverageNotes.length > 0 ? (
        <div className="ship-gate-group ship-gate-group--coverage" data-testid="ship-gate-coverage">
          <h4 className="ship-gate-group-title">Not checked by this scan</h4>
          <ul className="ship-gate-list">
            {coverageNotes.map((note) => (
              <li key={note} className="ship-gate-list-item ship-gate-coverage-note">
                {note}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {!redactFindings && advisories.length > 0 ? (
        <div
          className="ship-gate-group ship-gate-group--advisory"
          data-testid="ship-gate-advisories"
        >
          <h4 className="ship-gate-group-title">Good to know · not scored</h4>
          <ul className="ship-gate-list">
            {advisories.map((item) => (
              <li key={item.id} className="ship-gate-list-item">
                <span className="ship-gate-list-label">{item.label}</span>
                <p className="ship-gate-list-consequence">{item.sampleMessage}</p>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {!redactFindings && setup.length > 0 ? (
        <div className="ship-gate-group ship-gate-group--setup" data-testid="ship-gate-setup">
          <h4 className="ship-gate-group-title">Optional setup</h4>
          <ul className="ship-gate-list">
            {setup.map((item) => (
              <ShipGateGroupRow key={item.id} group={item} fileSuffix="" />
            ))}
          </ul>
        </div>
      ) : null}

      {redactFindings &&
      (report.blockers.length > 0 || report.reviews.length > 0 || report.warnings.length > 0) ? (
        <p className="ship-gate-redacted-hint" data-testid="ship-gate-redacted-hint">
          Sign in to see exactly which files and lines are affected.
        </p>
      ) : null}

      <div className="ship-gate-footer">
        {report.scannedFileCount === 0 ? null : report.status === 'ready' ? (
          <p className="ship-gate-clean" role="status">
            <span aria-hidden="true">✓</span>
            {report.cleanFileCount > 0
              ? `${formatCount(report.cleanFileCount, 'file')} clean`
              : 'All scanned files passed with no issues.'}
          </p>
        ) : report.cleanFileCount > 0 ? (
          <p className="ship-gate-clean ship-gate-clean--partial" role="status">
            {formatCount(report.cleanFileCount, 'file')} of {report.scannedFileCount} had no issues
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
                {onStopSharing ? (
                  <StopSharingButton
                    onStopSharing={onStopSharing}
                    isStopping={isStoppingShare}
                    hasBadge={Boolean(badgeMarkdown)}
                  />
                ) : null}
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
