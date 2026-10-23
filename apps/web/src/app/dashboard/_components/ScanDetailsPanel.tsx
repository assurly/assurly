'use client';

import { useEffect, useState, type ReactElement } from 'react';
import { ShipGatePanel, type ShipGateBillingPlan } from '../../_components/ship-gate/ShipGatePanel';
import type { Scan, ScanFinding } from '../../../utils/dbAdapter';
import { buildAiFixPrompt } from '../../../utils/aiFixPrompt';
import { formatCount, pluralize } from '../../../utils/pluralize';
import type { ScanFixSummary } from '../../../utils/fixSummary';
import type { ResolvedSincePrevious } from '../../../utils/scanResolved';
import type { ShipGateReport } from '../../../utils/shipGate';
import { DashboardToast, type DashboardToastData } from './DashboardToast';
import { ScanFindingsDetails } from './ScanFindingsDetails';

export const SCAN_DETAILS_SECTION_ORDER = [
  'ship-gate',
  'fix-with-ai',
  'commit',
  'fix-summary',
  'findings',
] as const;

export type ScanDetailsSectionId = (typeof SCAN_DETAILS_SECTION_ORDER)[number];

export interface ScanDetailsPanelProps {
  selectedScan: Scan;
  /** Named in the fix prompt so the agent knows which project it is in. */
  repositoryName?: string;
  shipGateReport: ShipGateReport;
  fixSummary: ScanFixSummary | null;
  /** Problems the previous commit had and this one no longer has. */
  resolvedSincePrevious?: ResolvedSincePrevious | null;
  displayedFindings: ScanFinding[];
  findingsLimit?: number;
  billingPlan?: ShipGateBillingPlan;
  shareUrl?: string | null;
  badgeMarkdown?: string | null;
  onShare?: () => void;
  isSharing?: boolean;
  onStopSharing?: () => void;
  isStoppingShare?: boolean;
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

function toWebFinding(finding: ScanFinding) {
  return {
    ruleId: finding.rule_id,
    severity: finding.severity,
    message: finding.message,
    suggestion: finding.suggestion,
    file: finding.file_path,
    line: finding.line_number,
  };
}

export function ScanDetailsPanel({
  selectedScan,
  repositoryName,
  shipGateReport,
  fixSummary,
  resolvedSincePrevious = null,
  displayedFindings,
  findingsLimit = 100,
  billingPlan,
  shareUrl = null,
  badgeMarkdown = null,
  onShare,
  isSharing = false,
  onStopSharing,
  isStoppingShare = false,
  shareError = null,
  fixingFindingId,
  isFindingFixable,
  onCreateFixPr,
  onCreateBatchFixPr,
}: ScanDetailsPanelProps): ReactElement {
  const [copyToast, setCopyToast] = useState<DashboardToastData | null>(null);

  useEffect(() => {
    if (!copyToast) return;
    const timer = window.setTimeout(() => setCopyToast(null), 3000);
    return () => window.clearTimeout(timer);
  }, [copyToast]);

  const showFixSummary =
    fixSummary !== null &&
    (fixSummary.blockerCount > 0 ||
      fixSummary.fixableCount > 0 ||
      fixSummary.remainingCount > 0 ||
      displayedFindings.some((finding) => finding.severity === 'error'));

  const handleCopyFixPrompt = async (): Promise<void> => {
    const prompt = buildAiFixPrompt(displayedFindings.map(toWebFinding), {
      repository: repositoryName,
      commit: selectedScan.commit_sha,
      notChecked: shipGateReport.coverageNotes,
    });
    try {
      await navigator.clipboard.writeText(prompt);
      setCopyToast({
        type: 'success',
        message: 'Fix prompt copied to clipboard.',
      });
    } catch {
      setCopyToast({
        type: 'error',
        message: 'Could not copy the fix prompt. Check browser clipboard permissions.',
      });
    }
  };

  /** Problems as the Ship Gate groups them — the count the prompt will carry. */
  const problemCount =
    shipGateReport.blockers.length + shipGateReport.reviews.length + shipGateReport.warnings.length;

  const showPrimaryFixCta =
    fixSummary !== null && fixSummary.remainingCount > 0 && fixingFindingId !== 'batch';

  return (
    <div
      id="scan-details-container"
      className="scan-details-container"
      data-testid="scan-details-container"
    >
      {copyToast ? <DashboardToast toast={copyToast} onDismiss={() => setCopyToast(null)} /> : null}

      <section
        data-scan-section="ship-gate"
        data-testid="scan-details-ship-gate"
        aria-label="Ship Gate verdict"
      >
        <ShipGatePanel
          report={shipGateReport}
          billingPlan={billingPlan}
          shareUrl={shareUrl}
          badgeMarkdown={badgeMarkdown}
          onShare={onShare}
          isSharing={isSharing}
          onStopSharing={onStopSharing}
          isStoppingShare={isStoppingShare}
          shareError={shareError}
          resolvedSincePrevious={resolvedSincePrevious}
        />
      </section>

      {problemCount > 0 ? (
        <section
          className="scan-fix-with-ai"
          data-scan-section="fix-with-ai"
          aria-labelledby="scan-fix-with-ai-title"
        >
          <div className="scan-fix-with-ai__copy">
            <h3 id="scan-fix-with-ai-title" className="scan-fix-with-ai__title">
              Fix with your AI editor
            </h3>
            <p className="scan-fix-with-ai__hint">
              One prompt for Cursor, Claude Code, Codex or Lovable:{' '}
              {problemCount === 1
                ? 'the problem above and the check that proves it is fixed.'
                : `${formatCount(problemCount, 'problem')} in the order they block launch, and the check that proves they are fixed.`}
            </p>
          </div>
          <button
            type="button"
            className="scan-finding-action-btn scan-finding-action-btn--success"
            onClick={() => {
              void handleCopyFixPrompt();
            }}
            data-testid="scan-copy-fix-prompt"
          >
            Copy fix prompt
          </button>
        </section>
      ) : null}

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
            <span className="scan-fix-summary__label">Remediation</span>
            <strong className="scan-fix-summary__value scan-fix-summary__value--fix">
              Fix these issues
            </strong>
            <p className="scan-fix-summary__hint">
              Open auto-fix pull requests or copy a paste-ready prompt for your AI editor.
            </p>
          </div>

          <div className="scan-fix-summary__metric">
            <span className="scan-fix-summary__label">Upstream code</span>
            <strong className="scan-fix-summary__value scan-fix-summary__value--issue">
              {formatCount(fixSummary.blockerCount, 'blocker')} ·{' '}
              {formatCount(fixSummary.findingCount, 'finding')}
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
                ? `${formatCount(fixSummary.remainingCount, 'auto-fix', 'auto-fixes')} can still be opened as ${pluralize(fixSummary.remainingCount, 'a pull request', 'pull requests')}.`
                : fixSummary.fixableCount > 0
                  ? 'All auto-fixable findings already have linked pull requests.'
                  : 'No auto-fixable findings in this scan.'}
            </p>
          </div>

          <div className="scan-fix-summary__actions">
            {showPrimaryFixCta ? (
              <button
                type="button"
                className="scan-finding-action-btn scan-finding-action-btn--success"
                onClick={onCreateBatchFixPr}
                disabled={fixingFindingId !== null}
                aria-busy={fixingFindingId === 'batch'}
                data-testid="scan-fix-primary-cta"
              >
                {fixingFindingId === 'batch' ? (
                  <>
                    <span className="scan-finding-action-spinner" aria-hidden="true" />
                    Fixing...
                  </>
                ) : (
                  <>Fix these issues</>
                )}
              </button>
            ) : null}
          </div>

          {fixSummary.fixableCount > 1 && fixSummary.remainingCount > 1 ? (
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
