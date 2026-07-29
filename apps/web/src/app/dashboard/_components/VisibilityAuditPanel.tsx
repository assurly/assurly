'use client';

import type { ReactElement } from 'react';
import type {
  VisibilityCheck,
  VisibilityReport,
  VisibilityStatus,
  VisibilityVerdict,
} from '../../../utils/visibilityScan';

/** Headline shape returned to unentitled plans (no check array). */
export type VisibilityHeadline = Pick<
  VisibilityReport,
  'score' | 'aiReadinessScore' | 'searchReadinessScore' | 'verdict'
>;

export type VisibilityView = VisibilityHeadline & {
  checks?: VisibilityCheck[];
};

interface VisibilityAuditPanelProps {
  report: VisibilityView;
  /**
   * When true, hides the per-check list entirely (not just visually) — free /
   * anonymous callers receive scores + verdict only. Mirrors `redactFindings`
   * on ShipGatePanel.
   */
  locked?: boolean;
}

const VERDICT_LABEL: Record<VisibilityVerdict, string> = {
  visible: 'FULLY VISIBLE',
  partial: 'PARTIALLY VISIBLE',
  invisible: 'INVISIBLE TO AI',
};

function statusLabel(status: VisibilityStatus): string {
  switch (status) {
    case 'pass':
      return 'Pass';
    case 'warn':
      return 'Warn';
    case 'fail':
      return 'Fail';
    case 'skipped':
      return 'Not checked';
    default: {
      const exhaustive: never = status;
      return String(exhaustive);
    }
  }
}

function statusText(status: VisibilityStatus): string {
  // Text labels so status is never conveyed by colour alone (a11y).
  switch (status) {
    case 'pass':
      return 'Passed';
    case 'warn':
      return 'Warning';
    case 'fail':
      return 'Failed';
    case 'skipped':
      return 'Not checked';
    default: {
      const exhaustive: never = status;
      return String(exhaustive);
    }
  }
}

/**
 * SEO & GEO Audit — parallel to Ship Gate. Own vocabulary, own scores, never
 * merged into the security verdict.
 */
export function VisibilityAuditPanel({
  report,
  locked = false,
}: VisibilityAuditPanelProps): ReactElement {
  const checks = locked ? undefined : report.checks;
  const showChecks = Array.isArray(checks) && checks.length > 0;

  return (
    <section
      className={`visibility-audit visibility-audit--${report.verdict}${locked ? ' visibility-audit--locked' : ''}`}
      aria-label="SEO and GEO audit"
      data-testid="visibility-audit"
    >
      <h3 className="visibility-audit__heading">SEO &amp; GEO Audit</h3>

      <div className="visibility-audit__header">
        <div className="visibility-audit__verdict" data-testid="visibility-audit-verdict">
          <span className="visibility-audit__verdict-label">{VERDICT_LABEL[report.verdict]}</span>
        </div>
        <div
          className="visibility-audit__score"
          aria-label={`AI Readiness Score ${report.score} out of 100`}
          data-testid="visibility-audit-score"
        >
          <span className="visibility-audit__score-label">AI Readiness Score</span>
          <strong className="visibility-audit__score-value">{report.score}/100</strong>
        </div>
      </div>

      <dl className="visibility-audit__subscores">
        <div className="visibility-audit__subscore">
          <dt>AI readiness</dt>
          <dd aria-label={`AI readiness ${report.aiReadinessScore} out of 100`}>
            {report.aiReadinessScore}/100
          </dd>
        </div>
        <div className="visibility-audit__subscore">
          <dt>Search readiness</dt>
          <dd aria-label={`Search readiness ${report.searchReadinessScore} out of 100`}>
            {report.searchReadinessScore}/100
          </dd>
        </div>
      </dl>

      {showChecks ? (
        <ul className="visibility-audit__checks" data-testid="visibility-audit-checks">
          {checks.map((check) => (
            <li
              key={check.id}
              className={`visibility-audit__check visibility-audit__check--${check.status}`}
              data-testid={`visibility-check-${check.id}`}
            >
              <div className="visibility-audit__check-head">
                <span className="visibility-audit__check-title">{check.title}</span>
                <span
                  className={`visibility-audit__check-status visibility-audit__check-status--${check.status}`}
                  aria-label={statusText(check.status)}
                >
                  {statusLabel(check.status)}
                </span>
              </div>
              <p className="visibility-audit__check-detail">{check.detail}</p>
              {check.status !== 'pass' && check.status !== 'skipped' && check.fix ? (
                <p className="visibility-audit__check-fix">
                  <span className="visibility-audit__fix-label">Fix</span>
                  {check.fix}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}

      {locked ? (
        <p className="visibility-audit__locked-hint" data-testid="visibility-audit-locked-hint">
          Upgrade to Pro to see every SEO &amp; GEO check and the exact fix for each gap.
        </p>
      ) : null}
    </section>
  );
}
