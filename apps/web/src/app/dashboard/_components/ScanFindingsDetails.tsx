'use client';

import { useMemo, type ReactElement } from 'react';
import type { ScanFinding } from '../../../utils/dbAdapter';
import { dedupeScanFindingsForDisplay } from '../../../utils/scanFindingsDisplay';
import { DashboardChevronIcon } from './icons/DashboardIcons';
import { ScanFindingCard } from './ScanFindingCard';

interface ScanFindingsDetailsProps {
  findings: ScanFinding[];
  findingsLimit: number;
  fixingFindingId: string | null;
  isFindingFixable: (finding: ScanFinding) => boolean;
  onCreateFixPr: (finding: ScanFinding) => void;
}

export function formatFindingsDetailsSummary(count: number): string {
  return count === 1 ? '1 finding' : `${count} findings`;
}

export function ScanFindingsDetails({
  findings,
  findingsLimit,
  fixingFindingId,
  isFindingFixable,
  onCreateFixPr,
}: ScanFindingsDetailsProps): ReactElement {
  const displayFindings = useMemo(() => dedupeScanFindingsForDisplay(findings), [findings]);

  return (
    <details
      className="scan-findings-details"
      data-scan-section="findings"
      data-testid="scan-details-findings"
    >
      <summary
        className="scan-findings-details__summary"
        data-testid="scan-findings-details-toggle"
      >
        <span className="scan-findings-details__copy">
          <span className="scan-findings-details__summary-label">
            {formatFindingsDetailsSummary(findings.length)}
          </span>
          <span className="scan-findings-details__summary-hint">
            File-level messages, suggestions, and auto-fix actions
          </span>
        </span>
        <span className="scan-findings-details__action">
          <span className="scan-findings-details__action-show">View details</span>
          <span className="scan-findings-details__action-hide">Hide details</span>
          <DashboardChevronIcon className="scan-findings-details__chevron" />
        </span>
      </summary>

      <div className="scan-findings-details__panel">
        {findings.length > findingsLimit ? (
          <div role="note" className="scan-findings-notice">
            Showing all {findings.length} findings from this run. Scan history stores the first{' '}
            {findingsLimit}.
          </div>
        ) : null}

        <div className="scan-findings-details__list">
          {displayFindings.map(({ occurrenceCount, ...finding }) => (
            <ScanFindingCard
              key={finding.id}
              finding={finding}
              occurrenceCount={occurrenceCount}
              fixingFindingId={fixingFindingId}
              isFixable={isFindingFixable(finding)}
              onCreateFixPr={onCreateFixPr}
            />
          ))}
        </div>
      </div>
    </details>
  );
}
