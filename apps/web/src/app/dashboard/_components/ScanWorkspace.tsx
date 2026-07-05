'use client';

import type { ReactElement } from 'react';
import type { Organization, Repository, Scan, ScanFinding } from '../../../utils/dbAdapter';
import type { ScanFixSummary } from '../../../utils/fixSummary';
import type { ShipGateReport } from '../../../utils/shipGate';
import { ShipScoreTrendChart } from './ShipScoreTrendChart';
import { ScanDetailsPanel } from './ScanDetailsPanel';
import { ScanDetailsSkeleton } from './ScanDetailsSkeleton';
import { ScanHistoryRail } from './ScanHistoryRail';
import { SelectedRepoHeader } from './SelectedRepoHeader';
import {
  DashboardBuildingIcon,
  DashboardFolderIcon,
  DashboardZapIcon,
} from './icons/DashboardIcons';
import type { RepoDetailStatus } from './repoSelection';

export interface ScanWorkspaceProps {
  selectedRepo: Repository | null;
  githubInstallationId?: string | null;
  billingPlan?: Organization['billing_plan'];
  selectedRepoScanCount: number;
  canJumpToScanResults: boolean;
  onJumpToResults: () => void;
  isScanning: boolean;
  onRunScan: () => void;
  scanError: string | null;
  onDismissScanError: () => void;
  scanProgress: number;
  scanLogs: string[];
  repoDetailStatus: RepoDetailStatus;
  displayedScans: Scan[];
  selectedScan: Scan | null;
  onSelectScan: (scan: Scan) => void;
  shipGateReport: ShipGateReport | null;
  fixSummary: ScanFixSummary | null;
  displayedFindings: ScanFinding[];
  findingsLimit: number;
  fetchTrend: (
    repositoryId: string,
  ) => Promise<{ points: Array<{ date: string; shipScore: number }> }>;
  selectedShareUrl: string | null;
  selectedBadgeMarkdown: string | null;
  onShare?: () => void;
  isSharing: boolean;
  shareError: string | null;
  fixingFindingId: string | null;
  isFindingFixable: (finding: ScanFinding) => boolean;
  onCreateFixPr: (finding: ScanFinding) => void;
  onCreateBatchFixPr: () => void;
}

function getScanLogLineClass(log: string): string {
  if (log.includes('✓')) {
    return 'dashboard-scan-log__line dashboard-scan-log__line--success';
  }
  if (log.includes('ERROR') || log.includes('❌')) {
    return 'dashboard-scan-log__line dashboard-scan-log__line--error';
  }
  if (log.includes('⚠')) {
    return 'dashboard-scan-log__line dashboard-scan-log__line--warning';
  }
  return 'dashboard-scan-log__line dashboard-scan-log__line--muted';
}

export function ScanWorkspace({
  selectedRepo,
  githubInstallationId,
  billingPlan,
  selectedRepoScanCount,
  canJumpToScanResults,
  onJumpToResults,
  isScanning,
  onRunScan,
  scanError,
  onDismissScanError,
  scanProgress,
  scanLogs,
  repoDetailStatus,
  displayedScans,
  selectedScan,
  onSelectScan,
  shipGateReport,
  fixSummary,
  displayedFindings,
  findingsLimit,
  fetchTrend,
  selectedShareUrl,
  selectedBadgeMarkdown,
  onShare,
  isSharing,
  shareError,
  fixingFindingId,
  isFindingFixable,
  onCreateFixPr,
  onCreateBatchFixPr,
}: ScanWorkspaceProps): ReactElement {
  if (!selectedRepo) {
    return (
      <section className="dashboard-scan-workspace">
        <div className="dashboard-empty-state dashboard-empty-state--panel">
          <span className="dashboard-empty-state__icon">
            <DashboardBuildingIcon className="dashboard-icon--xl" />
          </span>
          <h3 className="dashboard-empty-state__title">No repository selected</h3>
          <p className="dashboard-empty-state__copy">
            Choose a repository from the left panel to run code analysis.
          </p>
        </div>
      </section>
    );
  }

  return (
    <section className="dashboard-scan-workspace">
      <SelectedRepoHeader
        repoName={selectedRepo.name}
        scanCount={selectedRepoScanCount}
        canJumpToResults={canJumpToScanResults}
        onJumpToResults={onJumpToResults}
      />

      <ShipScoreTrendChart repositoryId={selectedRepo.id} fetchTrend={fetchTrend} />

      <div className="repo-scan-card">
        <div className="repo-scan-header">
          <div className="dashboard-scan-workspace__repo-info">
            <h3 className="dashboard-repo-heading">
              <DashboardFolderIcon />
              <span>{selectedRepo.name}</span>
            </h3>
            <p className="dashboard-scan-workspace__meta">
              Connected via installation #{githubInstallationId}
            </p>
          </div>

          <button
            type="button"
            onClick={onRunScan}
            disabled={isScanning}
            className="dashboard-scan-action-btn"
            aria-label={isScanning ? 'Scanning repository' : 'Run secure scan'}
            aria-busy={isScanning}
          >
            {!isScanning ? <DashboardZapIcon /> : null}
            {isScanning ? 'Scanning...' : 'Run Secure Scan'}
          </button>
        </div>

        {scanError && !isScanning ? (
          <div className="dashboard-scan-error" role="alert" data-testid="scan-error-panel">
            <div className="dashboard-scan-error__content">
              <div>
                <p className="dashboard-scan-error__title">Scan failed</p>
                <p className="dashboard-scan-error__message">{scanError}</p>
                <p className="dashboard-scan-error__hint">
                  Fix the issue above, then run the scan again. This message stays here until you
                  retry or switch repositories.
                </p>
              </div>
              <button
                type="button"
                className="dashboard-scan-error__dismiss"
                aria-label="Dismiss scan error"
                onClick={onDismissScanError}
              >
                ×
              </button>
            </div>
          </div>
        ) : null}

        {isScanning ? (
          <div className="dashboard-scan-progress">
            <div className="dashboard-scan-progress__header">
              <span>Scanning repository...</span>
              <span>{scanProgress}%</span>
            </div>
            <progress
              className="dashboard-scan-progress__bar"
              value={scanProgress}
              max={100}
              aria-label="Scan progress"
            />
          </div>
        ) : null}

        {scanLogs.length > 0 && (isScanning || scanError) ? (
          <div className="dashboard-scan-log">
            {scanLogs.map((log, index) => (
              <div key={`${index}-${log}`} className={getScanLogLineClass(log)}>
                {log}
              </div>
            ))}
          </div>
        ) : null}

        {repoDetailStatus === 'loading' ? (
          <ScanDetailsSkeleton />
        ) : displayedScans.length > 0 ? (
          <div className="dashboard-scan-workspace__results">
            <ScanHistoryRail
              scans={displayedScans}
              selectedScanId={selectedScan?.id ?? null}
              onSelectScan={onSelectScan}
            />

            {repoDetailStatus === 'ready' && selectedScan && shipGateReport ? (
              <ScanDetailsPanel
                selectedScan={selectedScan}
                shipGateReport={shipGateReport}
                fixSummary={fixSummary}
                displayedFindings={displayedFindings}
                findingsLimit={findingsLimit}
                billingPlan={billingPlan}
                shareUrl={selectedShareUrl}
                badgeMarkdown={selectedBadgeMarkdown}
                onShare={onShare}
                isSharing={isSharing}
                shareError={shareError}
                fixingFindingId={fixingFindingId}
                isFindingFixable={isFindingFixable}
                onCreateFixPr={onCreateFixPr}
                onCreateBatchFixPr={onCreateBatchFixPr}
              />
            ) : null}
          </div>
        ) : !isScanning && !scanError && repoDetailStatus === 'empty' ? (
          <div className="dashboard-empty-state dashboard-empty-state--inline">
            <span className="dashboard-empty-state__icon">
              <DashboardZapIcon className="dashboard-icon--lg" />
            </span>
            <h4 className="dashboard-empty-state__title">No scans found for this repository</h4>
            <p className="dashboard-empty-state__copy">
              Click &quot;Run Secure Scan&quot; above to initiate static analysis.
            </p>
          </div>
        ) : null}
      </div>
    </section>
  );
}
