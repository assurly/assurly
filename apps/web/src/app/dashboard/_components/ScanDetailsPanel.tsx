'use client';

import type { ReactElement } from 'react';
import { ShipGatePanel, type ShipGateBillingPlan } from '../../_components/ship-gate/ShipGatePanel';
import type { Scan, ScanFinding } from '../../../utils/dbAdapter';
import type { ScanFixSummary } from '../../../utils/fixSummary';
import type { ShipGateReport } from '../../../utils/shipGate';
import { ScanFindingsDetails } from './ScanFindingsDetails';

export const SCAN_DETAILS_SECTION_ORDER = [
  'ship-gate',
  'commit',
  'fix-summary',
  'findings',
] as const;

export type ScanDetailsSectionId = (typeof SCAN_DETAILS_SECTION_ORDER)[number];

export interface ScanDetailsPanelProps {
  selectedScan: Scan;
  shipGateReport: ShipGateReport;
  fixSummary: ScanFixSummary | null;
  displayedFindings: ScanFinding[];
  findingsLimit?: number;
  billingPlan?: ShipGateBillingPlan;
  shareUrl?: string | null;
  onShare?: () => void;
  isSharing?: boolean;
  shareError?: string | null;
  fixingFindingId: string | null;
  isFindingFixable: (finding: ScanFinding) => boolean;
  onCreateFixPr: (finding: ScanFinding) => void;
  onCreateBatchFixPr: () => void;
}

export function getScanDetailsSectionOrder(container: ParentNode): ScanDetailsSectionId[] {
  return [...container.querySelectorAll<HTMLElement>('[data-scan-section]')]
    .map((element) => element.dataset.scanSection as ScanDetailsSectionId | undefined)
    .filter((section): section is ScanDetailsSectionId => Boolean(section));
}

export function ScanDetailsPanel({
  selectedScan,
  shipGateReport,
  fixSummary,
  displayedFindings,
  findingsLimit = 100,
  billingPlan,
  shareUrl = null,
  onShare,
  isSharing = false,
  shareError = null,
  fixingFindingId,
  isFindingFixable,
  onCreateFixPr,
  onCreateBatchFixPr,
}: ScanDetailsPanelProps): ReactElement {
  const showFixSummary =
    fixSummary !== null &&
    (fixSummary.issueCount > 0 ||
      fixSummary.fixableCount > 0 ||
      fixSummary.remainingCount > 0 ||
      displayedFindings.some((finding) => finding.severity === 'error'));

  return (
    <div
      id="scan-details-container"
      className="scan-details-container"
      data-testid="scan-details-container"
    >
      <section
        data-scan-section="ship-gate"
        data-testid="scan-details-ship-gate"
        aria-label="Ship Gate verdict"
      >
        <ShipGatePanel
          report={shipGateReport}
          billingPlan={billingPlan}
          shareUrl={shareUrl}
          onShare={onShare}
          isSharing={isSharing}
          shareError={shareError}
        />
      </section>

      <div className="scan-details-header" data-scan-section="commit">
        <p className="scan-details-commit">
          Commit SHA: <strong>{selectedScan.commit_sha}</strong> on branch:{' '}
          <strong>{selectedScan.branch}</strong>
        </p>
      </div>

      {showFixSummary && fixSummary ? (
        <section
          className="scan-fix-summary"
          data-scan-section="fix-summary"
          data-testid="scan-details-fix-summary"
          aria-label="Auto-fix summary"
        >
          <div className="scan-fix-summary__metric">
            <span className="scan-fix-summary__label">Upstream code</span>
            <strong className="scan-fix-summary__value scan-fix-summary__value--issue">
              {fixSummary.issueCount} {fixSummary.issueCount === 1 ? 'issue' : 'issues'} detected
            </strong>
            <p className="scan-fix-summary__hint">
              The scan reads the repository branch on GitHub. Issues remain until fixes are merged
              upstream.
            </p>
          </div>
          <div className="scan-fix-summary__metric">
            <span className="scan-fix-summary__label">Proposed fixes</span>
            <strong className="scan-fix-summary__value scan-fix-summary__value--fix">
              {fixSummary.proposedCount} of {fixSummary.fixableCount} fix PRs ready
            </strong>
            <p className="scan-fix-summary__hint">
              {fixSummary.remainingCount > 0
                ? `${fixSummary.remainingCount} auto-fixes can still be opened as pull requests.`
                : fixSummary.fixableCount > 0
                  ? 'All auto-fixable findings already have linked pull requests.'
                  : 'No auto-fixable findings in this scan.'}
            </p>
          </div>
          {fixSummary.fixableCount > 1 && fixSummary.remainingCount > 0 ? (
            <div className="scan-fix-summary__actions">
              <button
                type="button"
                className="scan-finding-action-btn scan-finding-action-btn--batch"
                onClick={onCreateBatchFixPr}
                disabled={fixingFindingId !== null}
                aria-busy={fixingFindingId === 'batch'}
              >
                {fixingFindingId === 'batch' ? (
                  <>
                    <span className="scan-finding-action-spinner" aria-hidden="true" />
                    Creating combined PR...
                  </>
                ) : (
                  <>Create one PR for all {fixSummary.remainingCount} fixes</>
                )}
              </button>
            </div>
          ) : null}
          {fixSummary.sharedBatchPrUrl && fixSummary.proposedCount > 1 ? (
            <div className="scan-fix-summary__batch-link">
              <a
                href={fixSummary.sharedBatchPrUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="scan-finding-action-btn scan-finding-action-btn--success"
              >
                <span aria-hidden="true">↗</span> View combined fix PR
              </a>
            </div>
          ) : null}
        </section>
      ) : null}

      {displayedFindings.length > 0 ? (
        <ScanFindingsDetails
          key={selectedScan.id}
          findings={displayedFindings}
          findingsLimit={findingsLimit}
          fixingFindingId={fixingFindingId}
          isFindingFixable={isFindingFixable}
          onCreateFixPr={onCreateFixPr}
        />
      ) : null}
    </div>
  );
}
