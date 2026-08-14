'use client';

import { useMemo, useState, type ReactElement } from 'react';
import type { ScanResult } from '../../../../utils/browserScanner';
import type { ProjectFile } from './useManualScan';
import { ProjectLoadStatus, type ProjectLoadState } from './ProjectLoadStatus';
import { buildProjectScanOverview, type ProjectFileStats } from './projectWorkspace';

interface ProjectWorkspaceViewProps {
  projectName: string;
  projectFiles: ProjectFile[];
  selectedProjectPath: string | null;
  scanResults: ScanResult;
  fixableCount: number;
  isApplyingAllFixes: boolean;
  canExportPatch: boolean;
  projectLoad?: ProjectLoadState | null;
  onFixAll: () => void;
  onDownloadZip: () => void;
  onDownloadPatch: () => void;
  onSelectFile: (path: string) => void;
  onUpdateFileContent: (path: string, content: string) => void;
  onClearProject: () => void;
}

function getFileIcon(path: string): string {
  if (path.endsWith('.sql')) return '🗄️';
  if (path.endsWith('.env') || path.endsWith('.env.example')) return '⚙️';
  return '📄';
}

function getStatusPillClass(status: ProjectFileStats['status']): string {
  switch (status) {
    case 'error':
      return 'project-stat-pill error';
    case 'warning':
      return 'project-stat-pill warning';
    case 'clean':
      return 'project-stat-pill clean';
    default: {
      const neverStatus: never = status;
      return neverStatus;
    }
  }
}

export function ProjectWorkspaceView({
  projectName,
  projectFiles,
  selectedProjectPath,
  scanResults,
  fixableCount,
  isApplyingAllFixes,
  canExportPatch,
  projectLoad = null,
  onFixAll,
  onDownloadZip,
  onDownloadPatch,
  onSelectFile,
  onUpdateFileContent,
  onClearProject,
}: ProjectWorkspaceViewProps): ReactElement {
  const [projectSearch, setProjectSearch] = useState('');
  const [showIssuesOnly, setShowIssuesOnly] = useState(true);

  const overview = useMemo(
    () => buildProjectScanOverview(projectFiles, scanResults.findings),
    [projectFiles, scanResults.findings],
  );

  const statsByPath = useMemo(
    () => new Map(overview.fileStats.map((entry) => [entry.path, entry])),
    [overview.fileStats],
  );

  const filteredFiles = useMemo(() => {
    const search = projectSearch.trim().toLowerCase();
    return overview.fileStats.filter((entry) => {
      if (showIssuesOnly && entry.status === 'clean') return false;
      if (!search) return true;
      return entry.path.toLowerCase().includes(search);
    });
  }, [overview.fileStats, projectSearch, showIssuesOnly]);

  const activeFile = projectFiles.find((file) => file.path === selectedProjectPath);
  const activeStats = selectedProjectPath ? statsByPath.get(selectedProjectPath) : undefined;

  return (
    <div className="project-workspace" aria-busy={projectLoad ? true : undefined}>
      {projectLoad ? (
        <div className="project-workspace-load-overlay">
          <ProjectLoadStatus kind={projectLoad.kind} label={projectLoad.label} variant="overlay" />
        </div>
      ) : null}
      <div className="project-workspace-header">
        <div className="project-meta-info">
          <span className="project-title-name">{projectName}</span>
          <span className="project-file-count">{overview.scannedFileCount} files</span>
        </div>

        <div className="project-scan-stats" aria-label="Project scan summary">
          {overview.errorCount > 0 ? (
            <span className={getStatusPillClass('error')}>
              {overview.errorCount} blocker{overview.errorCount === 1 ? '' : 's'}
            </span>
          ) : null}
          {overview.reviewCount > 0 ? (
            <span className={getStatusPillClass('warning')}>
              {overview.reviewCount} review{overview.reviewCount === 1 ? '' : 's'}
            </span>
          ) : null}
          {overview.warningCount > 0 ? (
            <span className={getStatusPillClass('warning')}>
              {overview.warningCount} warning{overview.warningCount === 1 ? '' : 's'}
            </span>
          ) : null}
          {overview.totalErrorFindings > overview.errorCount ? (
            <span className="project-stat-pill" title="Raw error findings listed per file below">
              {overview.totalErrorFindings} in file log
            </span>
          ) : null}
          {overview.cleanFileCount > 0 ? (
            <span className={getStatusPillClass('clean')}>{overview.cleanFileCount} clean</span>
          ) : null}
        </div>

        <div className="project-header-actions">
          {fixableCount > 0 ? (
            <button
              type="button"
              className="project-action-btn-sm accent"
              onClick={onFixAll}
              disabled={isApplyingAllFixes}
              aria-busy={isApplyingAllFixes}
            >
              {isApplyingAllFixes ? 'Applying fixes…' : `Fix all auto-fixable (${fixableCount})`}
            </button>
          ) : null}
          <button
            type="button"
            className="project-action-btn-sm"
            onClick={onDownloadZip}
            aria-label="Download current project as ZIP"
          >
            Download ZIP
          </button>
          <button
            type="button"
            className="project-action-btn-sm"
            onClick={onDownloadPatch}
            disabled={!canExportPatch}
            aria-label="Download patch file for local changes"
          >
            Download patch
          </button>
          <button type="button" className="project-action-btn-sm danger" onClick={onClearProject}>
            Clear Project
          </button>
        </div>
      </div>

      <div className="project-workspace-toolbar">
        <label className="project-filter-toggle">
          <input
            type="checkbox"
            checked={showIssuesOnly}
            onChange={(event) => setShowIssuesOnly(event.target.checked)}
          />
          <span>Show files with issues only</span>
        </label>
      </div>

      <div className="project-workspace-body">
        <div className="mobile-file-selector">
          <label className="mobile-file-label" htmlFor="mobile-file-select">
            Active file
          </label>
          <select
            id="mobile-file-select"
            className="mobile-select-dropdown"
            value={selectedProjectPath || ''}
            onChange={(event) => onSelectFile(event.target.value)}
          >
            <option value="" disabled>
              Choose a file
            </option>
            {filteredFiles.map((entry) => {
              const suffix =
                entry.status === 'clean'
                  ? ' · clean'
                  : entry.status === 'error'
                    ? ` · ${entry.errorCount + entry.warningCount} issues`
                    : ` · ${entry.warningCount} warnings`;
              return (
                <option key={entry.path} value={entry.path}>
                  {entry.path}
                  {suffix}
                </option>
              );
            })}
          </select>
        </div>

        <aside className="project-sidebar" aria-label="Project files">
          <label className="visually-hidden" htmlFor="project-file-filter">
            Filter project files
          </label>
          <input
            id="project-file-filter"
            type="search"
            className="file-search-input"
            placeholder="Search files…"
            value={projectSearch}
            onChange={(event) => setProjectSearch(event.target.value)}
          />

          <div className="project-file-list">
            {filteredFiles.map((entry) => {
              const statusClass =
                entry.status === 'error'
                  ? 'has-errors'
                  : entry.status === 'warning'
                    ? 'has-warnings'
                    : 'is-clean';

              return (
                <button
                  key={entry.path}
                  type="button"
                  className={`project-file-item ${selectedProjectPath === entry.path ? 'active' : ''} ${statusClass}`}
                  onClick={() => onSelectFile(entry.path)}
                >
                  <span className="file-item-icon">{getFileIcon(entry.path)}</span>
                  <div className="file-item-info">
                    <span className="file-item-name">{entry.path.split('/').pop()}</span>
                    <span className="file-item-path">{entry.path}</span>
                  </div>
                  {entry.status !== 'clean' ? (
                    <span
                      className={`file-status-indicator ${entry.status === 'error' ? 'error' : 'warn'}`}
                    >
                      {entry.errorCount + entry.warningCount}
                    </span>
                  ) : (
                    <span className="file-status-indicator clean">OK</span>
                  )}
                </button>
              );
            })}
            {filteredFiles.length === 0 ? (
              <div className="no-files-found">
                {showIssuesOnly
                  ? 'No files with issues match your search.'
                  : 'No files match your search.'}
              </div>
            ) : null}
          </div>
        </aside>

        <div className="project-editor-container">
          {activeFile ? (
            <>
              <div className="editor-label project-editor-header">
                <span className="project-editor-path">{activeFile.path}</span>
                <span className={`project-editor-status ${activeStats?.status ?? 'clean'}`}>
                  {activeStats?.status === 'error'
                    ? `${activeStats.errorCount + activeStats.warningCount} issues`
                    : activeStats?.status === 'warning'
                      ? `${activeStats.warningCount} warnings`
                      : 'No issues'}
                </span>
              </div>
              <textarea
                id="project-active-file-editor"
                aria-label={`Edit ${activeFile.path}`}
                className="code-textarea project-editor-textarea"
                value={activeFile.content}
                onChange={(event) => onUpdateFileContent(activeFile.path, event.target.value)}
              />
            </>
          ) : (
            <div className="no-file-selected">
              Select a file from the list to inspect and edit its contents.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
