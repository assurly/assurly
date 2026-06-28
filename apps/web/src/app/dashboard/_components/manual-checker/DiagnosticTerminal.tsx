import { useEffect, useMemo, useRef, type ReactElement } from 'react';
import { ShipGatePanel } from '../../../_components/ship-gate/ShipGatePanel';
import type { WebFinding } from '../../../../utils/browserScanner';
import { buildShipGateFromWebFindings } from '../../../../utils/shipGate';
import type { ManualCheckerTab } from './useManualScan';
import {
  buildIssueGroupSummaries,
  buildScanMetricSummary,
  getScanActionLabel,
  type IssueGroupSummary,
  type ProjectFileStats,
  type ProjectScanVerdict,
  type ScanMetricSummary,
} from './projectWorkspace';

interface DiagnosticTerminalProps {
  activeTab: ManualCheckerTab;
  scannedFileLabels: string[];
  projectScan?: {
    fileStats: ProjectFileStats[];
    metrics: ScanMetricSummary;
    issueGroups: IssueGroupSummary[];
  };
  results: {
    errorCount: number;
    warningCount: number;
    findings: WebFinding[];
  };
  selectedProjectPath: string | null;
  isFindingFixable: (finding: WebFinding) => boolean;
  fixingFindingId: string | null;
  fixableCount?: number;
  isApplyingAllFixes?: boolean;
  onApplyFix: (finding: WebFinding) => void;
  onFixAll?: () => void;
}

function getOverallVerdict(errorCount: number, warningCount: number): ProjectScanVerdict {
  if (errorCount > 0) return 'failed';
  if (warningCount > 0) return 'warnings';
  return 'passed';
}

function findingKey(finding: WebFinding): string {
  return `${finding.file || ''}-${finding.line || 0}-${finding.message || ''}`;
}

function ProjectMetrics({ metrics }: { metrics: ScanMetricSummary }): ReactElement {
  return (
    <div className="diagnostic-summary-metrics" aria-live="polite">
      <span className="scan-metric error" title="Distinct blocking issue types">
        {metrics.uniqueErrorCount} unique errors
      </span>
      <span className="scan-metric metric-secondary" title="Total error findings across files">
        {metrics.totalErrorFindings} total
      </span>
      {metrics.uniqueWarningCount > 0 ? (
        <span className="scan-metric warning" title="Distinct warning types">
          {metrics.uniqueWarningCount} warnings
        </span>
      ) : null}
      <span className="scan-metric metric-neutral" title="Files with at least one finding">
        {metrics.affectedFileCount} files affected
      </span>
      {metrics.testAffectedFileCount > 0 ? (
        <span className="scan-metric metric-neutral" title="Affected test/spec files">
          {metrics.testAffectedFileCount} in tests
        </span>
      ) : null}
      {metrics.cleanFileCount > 0 ? (
        <span className="scan-metric clean">{metrics.cleanFileCount} clean</span>
      ) : null}
    </div>
  );
}

function IssueGroupList({ groups }: { groups: IssueGroupSummary[] }): ReactElement {
  return (
    <section className="issue-group-panel" aria-label="Grouped root causes">
      <h4 className="diagnostic-section-label">Root causes</h4>
      <ul className="issue-group-list">
        {groups.map((group) => (
          <li key={group.id} className={`issue-group-item ${group.severity}`}>
            <span className={`issue-group-severity ${group.severity}`}>
              {group.severity === 'error' ? 'Error' : 'Warn'}
            </span>
            <div className="issue-group-copy">
              <span className="issue-group-label">{group.label}</span>
              <span className="issue-group-meta">
                {group.affectedFileCount} file{group.affectedFileCount === 1 ? '' : 's'} ·{' '}
                {group.occurrenceCount} finding{group.occurrenceCount === 1 ? '' : 's'}
              </span>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function FindingList({
  fileLabel,
  findings,
  isFindingFixable,
  fixingFindingId,
  onApplyFix,
}: {
  fileLabel: string;
  findings: WebFinding[];
  isFindingFixable: (finding: WebFinding) => boolean;
  fixingFindingId: string | null;
  onApplyFix: (finding: WebFinding) => void;
}): ReactElement {
  if (findings.length === 0) {
    return (
      <div className="active-file-empty">
        No configuration or security issues found in this file.
      </div>
    );
  }

  return (
    <>
      {findings.map((finding, idx) => {
        const id = findingKey(finding);
        const isCurrentlyFixing = fixingFindingId === id;
        const fixLabel = `Auto-fix ${finding.severity} in ${fileLabel}${
          finding.line ? ` at line ${finding.line}` : ''
        }`;

        return (
          <div key={`${id}-${idx}`} className="scan-finding-block">
            <div className="log-line">
              <span className={`log-badge ${finding.severity === 'error' ? 'error' : 'warn'}`}>
                {finding.severity.toUpperCase()}
              </span>
              <span className="log-message">
                {finding.line ? `[Line ${finding.line}] ` : ''}
                {finding.message}
              </span>
            </div>
            {finding.suggestion ? (
              <div className="log-suggestion">Suggestion: {finding.suggestion}</div>
            ) : null}
            {isFindingFixable(finding) ? (
              <button
                type="button"
                className="apply-fix-btn"
                aria-label={fixLabel}
                onClick={() => onApplyFix(finding)}
                disabled={isCurrentlyFixing}
              >
                {isCurrentlyFixing ? 'Fixing…' : 'Auto-Fix Code'}
              </button>
            ) : null}
          </div>
        );
      })}
    </>
  );
}

export function DiagnosticTerminal({
  activeTab,
  scannedFileLabels,
  projectScan,
  results,
  selectedProjectPath,
  isFindingFixable,
  fixingFindingId,
  fixableCount = 0,
  isApplyingAllFixes = false,
  onApplyFix,
  onFixAll,
}: DiagnosticTerminalProps): ReactElement {
  const isProjectMode = activeTab === 'project' && !!projectScan;
  const verdict = getOverallVerdict(results.errorCount, results.warningCount);
  const activeFindingsRef = useRef<HTMLElement | null>(null);

  const activeFileFindings =
    isProjectMode && selectedProjectPath
      ? results.findings.filter((finding) => finding.file === selectedProjectPath)
      : [];

  const shipGateReport = useMemo(() => {
    if (isProjectMode && projectScan) {
      return buildShipGateFromWebFindings(results.findings, {
        scannedFileCount: projectScan.metrics.scannedFileCount,
        cleanFileCount: projectScan.metrics.cleanFileCount,
      });
    }

    const scannedFileCount = Math.max(
      scannedFileLabels.length,
      new Set(results.findings.map((finding) => finding.file).filter(Boolean)).size,
    );
    const affectedCount = new Set(results.findings.map((finding) => finding.file).filter(Boolean))
      .size;

    return buildShipGateFromWebFindings(results.findings, {
      scannedFileCount,
      cleanFileCount: Math.max(0, scannedFileCount - affectedCount),
    });
  }, [isProjectMode, projectScan, results.findings, scannedFileLabels.length]);

  useEffect(() => {
    if (!isProjectMode || !selectedProjectPath) return;
    activeFindingsRef.current?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
  }, [isProjectMode, selectedProjectPath, activeFileFindings.length]);

  return (
    <div className="editor-box diagnostic-terminal">
      <div className="editor-label diagnostic-terminal-header">
        <span>ShipReady Diagnostic Logs</span>
        {isProjectMode ? (
          <ProjectMetrics metrics={projectScan.metrics} />
        ) : (
          <div className="diagnostic-summary-metrics" aria-live="polite">
            <span className="scan-metric error">{results.errorCount} Errors</span>
            <span className="scan-metric warning">{results.warningCount} Warnings</span>
          </div>
        )}
      </div>

      <ShipGatePanel
        report={shipGateReport}
        actionHint={
          isProjectMode
            ? `${projectScan?.metrics.scannedFileCount ?? 0} files scanned locally · ${getScanActionLabel(verdict)}`
            : `${scannedFileLabels.length} file${scannedFileLabels.length === 1 ? '' : 's'} analyzed · ${getScanActionLabel(verdict)}`
        }
      />

      <div className="terminal-output diagnostic-terminal-body">
        <div className="terminal-header">
          <div className="terminal-dot red" aria-hidden="true"></div>
          <div className="terminal-dot yellow" aria-hidden="true"></div>
          <div className="terminal-dot green" aria-hidden="true"></div>
        </div>

        <div className="log-line log-command">
          <span>$ shipready scan --browser-mode</span>
        </div>

        <div className="log-line">
          <span className="log-badge ok">OK</span>
          <span className="log-message log-message-success">
            Static Analysis Engine initialized.
          </span>
        </div>

        {isProjectMode ? (
          <>
            {fixableCount > 0 && onFixAll ? (
              <div
                className="project-bulk-fix-bar"
                role="region"
                aria-label="Bulk auto-fix actions"
              >
                <p className="project-bulk-fix-bar__copy">
                  ShipReady can auto-fix {fixableCount} local issue
                  {fixableCount === 1 ? '' : 's'} in your workspace (env docs, RLS SQL, webhook/RSC
                  patterns). Secrets and manual review items still need human action.
                </p>
                <button
                  type="button"
                  className="project-bulk-fix-bar__btn"
                  onClick={onFixAll}
                  disabled={isApplyingAllFixes}
                  aria-busy={isApplyingAllFixes}
                >
                  {isApplyingAllFixes
                    ? 'Applying all fixes…'
                    : `Fix all auto-fixable issues (${fixableCount})`}
                </button>
              </div>
            ) : null}

            {projectScan.issueGroups.length > 0 ? (
              <IssueGroupList groups={projectScan.issueGroups} />
            ) : null}

            <section
              ref={activeFindingsRef}
              className="active-file-findings"
              aria-label={
                selectedProjectPath
                  ? `Findings for ${selectedProjectPath}`
                  : 'Findings for selected file'
              }
            >
              <h4 className="diagnostic-section-label">Active file log</h4>
              {selectedProjectPath ? (
                <>
                  <p className="active-file-path">{selectedProjectPath}</p>
                  <p className="active-file-hint">
                    Use the workspace file list above to switch files. This panel always reflects
                    the file open in the editor.
                  </p>
                  <FindingList
                    fileLabel={selectedProjectPath}
                    findings={activeFileFindings}
                    isFindingFixable={isFindingFixable}
                    fixingFindingId={fixingFindingId}
                    onApplyFix={onApplyFix}
                  />
                </>
              ) : (
                <div className="active-file-empty">Select a project file to inspect findings.</div>
              )}
            </section>

            {projectScan.metrics.cleanFileCount > 0 ? (
              <div className="scan-clean-summary" role="status">
                <span className="scan-clean-summary-icon" aria-hidden="true">
                  ✓
                </span>
                <span>
                  {projectScan.metrics.cleanFileCount} additional file
                  {projectScan.metrics.cleanFileCount === 1 ? '' : 's'} passed with no issues.
                </span>
              </div>
            ) : null}
          </>
        ) : (
          <>
            {scannedFileLabels.map((fileName) => (
              <section
                key={fileName}
                className="snippet-file-findings"
                aria-label={`Findings for ${fileName}`}
              >
                <h4 className="diagnostic-section-label">{fileName}</h4>
                <FindingList
                  fileLabel={fileName}
                  findings={results.findings.filter((finding) => finding.file === fileName)}
                  isFindingFixable={isFindingFixable}
                  fixingFindingId={fixingFindingId}
                  onApplyFix={onApplyFix}
                />
              </section>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
