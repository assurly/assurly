'use client';

import type { ReactElement } from 'react';
import type { ScanFinding } from '../../../utils/dbAdapter';
import { findingFixPrUrl } from '../../../utils/fixSummary';

interface ScanFindingCardProps {
  finding: ScanFinding;
  occurrenceCount?: number;
  fixingFindingId: string | null;
  isFixable: boolean;
  onCreateFixPr: (finding: ScanFinding) => void;
}

export function ScanFindingCard({
  finding,
  occurrenceCount = 1,
  fixingFindingId,
  isFixable,
  onCreateFixPr,
}: ScanFindingCardProps): ReactElement {
  const severityClass =
    finding.severity === 'error' ? 'scan-finding-card--error' : 'scan-finding-card--warning';
  const fixPrUrl = findingFixPrUrl(finding);

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

      <p className="scan-finding-card__message">{finding.message}</p>

      {finding.suggestion ? (
        <p className="scan-finding-card__suggestion">
          <span className="scan-finding-card__suggestion-label">Suggestion</span>
          {finding.suggestion}
        </p>
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
