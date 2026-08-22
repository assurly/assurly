'use client';

import type { ReactElement } from 'react';
import type { FixOutcomeStatus, ScanFinding } from '../../../utils/dbAdapter';
import { getCuratedConsequenceForFinding } from '../../../utils/consequenceMap';
import { findingFixPrUrl } from '../../../utils/fixSummary';
import { VerifiedFixTimeline } from './VerifiedFixTimeline';

/** The verified-fix outcome for this finding, when a re-probe has recorded one. */
export interface FindingFixOutcome {
  outcome: FixOutcomeStatus;
  verifiedAt?: string | null;
}

interface ScanFindingCardProps {
  finding: ScanFinding;
  occurrenceCount?: number;
  fixingFindingId: string | null;
  isFixable: boolean;
  onCreateFixPr: (finding: ScanFinding) => void;
  fixOutcome?: FindingFixOutcome;
}

export function ScanFindingCard({
  finding,
  occurrenceCount = 1,
  fixingFindingId,
  isFixable,
  onCreateFixPr,
  fixOutcome,
}: ScanFindingCardProps): ReactElement {
  const severityClass =
    finding.severity === 'error' ? 'scan-finding-card--error' : 'scan-finding-card--warning';
  const fixPrUrl = findingFixPrUrl(finding);
  const consequence = getCuratedConsequenceForFinding({
    ruleId: finding.rule_id,
    message: finding.message,
  });
  // Consequence is the primary line a non-engineer reads; fall back to the raw
  // message only when no curated consequence exists for the rule.
  const primaryLine = consequence?.consequence ?? finding.message;
  const hasTechnicalDetail = Boolean(consequence) || Boolean(finding.suggestion);

  return (
    <article
      className={`scan-finding-card ${severityClass}`}
      data-testid={`scan-finding-card-${finding.id}`}
      aria-label={`${finding.severity} finding in ${finding.file_path}`}
    >
      <header className="scan-finding-card__header">
        <span className={`scan-finding-card__badge scan-finding-card__badge--${finding.severity}`}>
          {finding.severity}
        </span>
        <span className="scan-finding-card__location">
          {finding.file_path}
          {finding.line_number ? `:L${finding.line_number}` : ''}
        </span>
        {occurrenceCount > 1 ? (
          <span
            className="scan-finding-card__occurrence"
            aria-label={`${occurrenceCount} occurrences`}
            data-testid={`scan-finding-occurrence-${finding.id}`}
          >
            ×{occurrenceCount}
          </span>
        ) : null}
      </header>

      {consequence?.regulation ? (
        <span className="scan-finding-card__regulation">{consequence.regulation}</span>
      ) : null}

      <p className="scan-finding-card__consequence">{primaryLine}</p>

      {fixOutcome ? (
        <VerifiedFixTimeline
          outcome={fixOutcome.outcome}
          foundAt={finding.created_at}
          prUrl={fixPrUrl}
          verifiedAt={fixOutcome.verifiedAt}
        />
      ) : null}

      {hasTechnicalDetail ? (
        <details className="scan-finding-card__technical">
          <summary>For your developer</summary>
          {consequence ? <p className="scan-finding-card__message">{finding.message}</p> : null}
          {finding.suggestion ? (
            <p className="scan-finding-card__suggestion">
              <span className="scan-finding-card__suggestion-label">Suggestion</span>
              {finding.suggestion}
            </p>
          ) : null}
        </details>
      ) : null}

      {isFixable ? (
        <div className="scan-finding-action-row">
          {fixPrUrl ? (
            <a
              href={fixPrUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="scan-finding-action-btn scan-finding-action-btn--success"
            >
              <span aria-hidden="true">↗</span> View Fix PR
            </a>
          ) : (
            <button
              type="button"
              className="scan-finding-action-btn scan-finding-action-btn--success"
              onClick={() => onCreateFixPr(finding)}
              disabled={fixingFindingId === finding.id}
              aria-busy={fixingFindingId === finding.id}
            >
              {fixingFindingId === finding.id ? (
                <>
                  <span className="scan-finding-action-spinner" aria-hidden="true" />
                  Fixing...
                </>
              ) : (
                <>
                  <span aria-hidden="true">🔧</span> Fix it
                </>
              )}
            </button>
          )}
        </div>
      ) : null}
    </article>
  );
}
