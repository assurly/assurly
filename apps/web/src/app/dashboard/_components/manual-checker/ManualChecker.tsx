'use client';

import React, { useState, useRef } from 'react';
import type { WebFinding } from '../../../../utils/browserScanner';
import { useManualScan, type ManualCheckerTab, type ProjectFile } from './useManualScan';
import {
  readDroppedEntry,
  readFileListFromInput,
  readZipFile,
  type FileSystemEntry,
} from './projectFiles';
import { DashboardArchiveIcon, DashboardFolderIcon } from '../icons/DashboardIcons';
import { DiagnosticTerminal } from './DiagnosticTerminal';
import { ManualCheckerNavigation } from './ManualCheckerNavigation';
import { ProjectWorkspaceView } from './ProjectWorkspaceView';
import { ProjectLoadStatus, type ProjectLoadState } from './ProjectLoadStatus';
import {
  buildIssueGroupSummaries,
  buildProjectScanOverview,
  buildScanMetricSummary,
  countShipGateBlockers,
  scanProject,
} from './projectWorkspace';
import {
  applyAllFixableFindingsToProject,
  applySingleFindingToProject,
  appendRlsFix,
  applyEnvVarsToExampleFiles,
  buildBatchFixToastMessage,
  countFixableFindings,
  fixRscDataLeak,
  fixStripeWebhook,
  getManualFindingKey,
  isManualFindingFixable,
} from './projectAutoFix';
import { downloadProjectPatch, downloadProjectZip } from './projectExport';
import {
  cloneProjectFilesForUndo,
  describeAppliedFix,
  describeBatchAppliedFixes,
  popUndoEntry,
  pushUndoEntry,
} from './shipLoopJournal';
import type { AppliedManualFix, ManualFixKind, ShipLoopUndoEntry } from './shipLoopTypes';

function manualFixKindFromFinding(finding: WebFinding): ManualFixKind | null {
  const filePath = (finding.file || '').toLowerCase();
  const msg = (finding.message || '').toLowerCase();
  if (filePath.endsWith('.sql') && msg.includes('row-level security')) return 'rls';
  if (msg.includes('stripe webhook endpoint') && msg.includes('signature verification')) {
    return 'stripe';
  }
  if (msg.includes('environment variable') && msg.includes('not documented in')) return 'env';
  if (msg.includes("client component ('use client') imports server-side module")) return 'rsc';
  return null;
}

function projectFilesDifferFromSnapshot(
  files: ProjectFile[],
  snapshot: ProjectFile[] | null,
): boolean {
  if (!snapshot) return files.length > 0;
  if (files.length !== snapshot.length) return true;
  const byPath = new Map(snapshot.map((file) => [file.path, file.content]));
  return files.some((file) => byPath.get(file.path) !== file.content);
}

function describeFindingFix(finding: WebFinding): AppliedManualFix | null {
  const kind = manualFixKindFromFinding(finding);
  if (!kind) return null;
  const tableMatch = finding.message.match(/table '([^']+)'/i);
  const varMatch = finding.message.match(/variable 'process\.env\.([^']+)'/i);
  const moduleMatch = finding.message.match(/database client '([^']+)'/i);
  const detail =
    kind === 'rls'
      ? tableMatch?.[1]
      : kind === 'env'
        ? varMatch?.[1]
        : kind === 'rsc'
          ? moduleMatch?.[1]
          : undefined;
  return describeAppliedFix({
    kind,
    ruleId: finding.ruleId,
    detail,
    filePaths: finding.file ? [finding.file] : [],
  });
}

// Default mock contents for demonstration
const DEFAULT_SQL_MOCK = `-- Create profiles table
create table profiles (
  id uuid references auth.users on delete cascade primary key,
  username text unique,
  updated_at timestamp with time zone
);

-- Create posts table
create table posts (
  id uuid primary key,
  title text,
  content text,
  author_id uuid references profiles(id)
);

-- Enable RLS on posts only (forgot profiles!)
alter table posts enable row level security;`;

const DEFAULT_STRIPE_MOCK = `import { NextResponse } from 'next/server';
import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2023-10-16',
});

export async function POST(req: Request) {
  // Vulnerability: Missing Stripe signature verification!
  const body = await req.json();
  const eventType = body.type;

  if (eventType === 'checkout.session.completed') {
    const session = body.data.object;
    // Auto-unlock paid features without verifying request authenticity
    console.log('Unlock features for:', session.customer_details.email);
  }

  return NextResponse.json({ received: true });
}`;

const DEFAULT_ENV_EXAMPLE_MOCK = `PORT=3000
DATABASE_URL=`;

const DEFAULT_ENV_CODE_MOCK = `// DB connection
const dbUrl = process.env.DATABASE_URL;

// Stripe config (AI generated key use)
const stripeKey = process.env.STRIPE_SECRET_KEY;
const publishKey = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;`;

interface ManualCheckerProps {
  /** Optional callback when a toast notification should be shown */
  onToast?: (message: string, type: 'success' | 'info') => void;
}

/**
 * Self-contained Interactive Config Checker component.
 * Allows users to paste or drag & drop configuration files and scan them
 * for security and configuration issues using the browserScanner engine.
 */
export default function ManualChecker({ onToast }: ManualCheckerProps): React.ReactElement {
  const [activeTab, setActiveTab] = useState<ManualCheckerTab>('sql');

  // Tab content state
  const [sqlContent, setSqlContent] = useState<string>(DEFAULT_SQL_MOCK);
  const [stripeContent, setStripeContent] = useState<string>(DEFAULT_STRIPE_MOCK);
  const [envExampleContent, setEnvExampleContent] = useState<string>(DEFAULT_ENV_EXAMPLE_MOCK);
  const [envCodeContent, setEnvCodeContent] = useState<string>(DEFAULT_ENV_CODE_MOCK);

  // Active file names (set when user drops a file)
  const [sqlFileName, setSqlFileName] = useState<string | null>(null);
  const [stripeFileName, setStripeFileName] = useState<string | null>(null);
  const [envExampleFileName, setEnvExampleFileName] = useState<string | null>(null);
  const [envCodeFileName, setEnvCodeFileName] = useState<string | null>(null);

  // Project scan files states
  const [projectFiles, setProjectFiles] = useState<ProjectFile[]>([]);
  const [projectName, setProjectName] = useState<string>('');
  const [selectedProjectPath, setSelectedProjectPath] = useState<string | null>(null);
  const [projectLoad, setProjectLoad] = useState<ProjectLoadState | null>(null);

  // Drag & drop state
  const [dragActive, setDragActive] = useState<boolean>(false);
  const dragCounter = useRef(0);
  const zipInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);

  // Auto-Fix visual feedback states
  const [fixingFindingId, setFixingFindingId] = useState<string | null>(null);
  const [isApplyingAllFixes, setIsApplyingAllFixes] = useState<boolean>(false);
  const [flashSql, setFlashSql] = useState<boolean>(false);
  const [flashEnv, setFlashEnv] = useState<boolean>(false);
  const [flashStripe, setFlashStripe] = useState<boolean>(false);
  const projectSnapshotRef = useRef<ProjectFile[] | null>(null);
  const [projectHasLocalChanges, setProjectHasLocalChanges] = useState<boolean>(false);

  // Ship Loop: applied-fix journal + undo stack
  const [appliedFixes, setAppliedFixes] = useState<AppliedManualFix[]>([]);
  const [undoStack, setUndoStack] = useState<ShipLoopUndoEntry[]>([]);

  const clearShipLoop = (): void => {
    setAppliedFixes([]);
    setUndoStack([]);
  };

  const results = useManualScan({
    activeTab,
    sqlContent,
    stripeContent,
    envExampleContent,
    envCodeContent,
    sqlFileName,
    stripeFileName,
    envExampleFileName,
    envCodeFileName,
    projectFiles,
  });

  const isFindingFixable = isManualFindingFixable;

  const handleUndoLastFix = (): void => {
    const { entry, stack } = popUndoEntry(undoStack);
    if (!entry) {
      onToast?.('Nothing to undo.', 'info');
      return;
    }

    setUndoStack(stack);
    setAppliedFixes(entry.fixes);

    if (entry.mode === 'project') {
      setProjectFiles(entry.files);
      setProjectHasLocalChanges(
        projectFilesDifferFromSnapshot(entry.files, projectSnapshotRef.current),
      );
      onToast?.('Reverted the last Assurly auto-fix.', 'info');
      return;
    }

    if (entry.mode === 'sql' && entry.content.sql !== undefined) {
      setSqlContent(entry.content.sql);
    } else if (entry.mode === 'stripe' && entry.content.stripe !== undefined) {
      setStripeContent(entry.content.stripe);
    } else if (entry.mode === 'env') {
      if (entry.content.envExample !== undefined) {
        setEnvExampleContent(entry.content.envExample);
      }
      if (entry.content.envCode !== undefined) {
        setEnvCodeContent(entry.content.envCode);
      }
    }
    onToast?.('Reverted the last Assurly auto-fix.', 'info');
  };

  const handleApplyFix = (f: WebFinding): void => {
    const findingId = getManualFindingKey(f);
    setFixingFindingId(findingId);

    const filePath = (f.file || '').toLowerCase();
    const msg = (f.message || '').toLowerCase();
    const journalCard = describeFindingFix(f);

    const undoEntry: ShipLoopUndoEntry =
      activeTab === 'project'
        ? {
            mode: 'project',
            files: cloneProjectFilesForUndo(projectFiles),
            fixes: [...appliedFixes],
          }
        : activeTab === 'sql'
          ? { mode: 'sql', content: { sql: sqlContent }, fixes: [...appliedFixes] }
          : activeTab === 'stripe'
            ? { mode: 'stripe', content: { stripe: stripeContent }, fixes: [...appliedFixes] }
            : {
                mode: 'env',
                content: { envExample: envExampleContent, envCode: envCodeContent },
                fixes: [...appliedFixes],
              };

    setTimeout(() => {
      setUndoStack((stack) => pushUndoEntry(stack, undoEntry));
      if (journalCard) {
        setAppliedFixes((prev) => [...prev, journalCard]);
      }

      if (activeTab === 'project' && undoEntry.mode === 'project') {
        const next = applySingleFindingToProject(undoEntry.files, f);
        setProjectFiles(next);
        setProjectHasLocalChanges(true);

        if (filePath.endsWith('.sql') && msg.includes('row-level security')) {
          setFlashSql(true);
          setTimeout(() => setFlashSql(false), 1500);
          const tableMatch = f.message.match(/table '([^']+)'/i);
          onToast?.(
            `Row-Level Security (RLS) successfully enabled for table: ${tableMatch?.[1] ?? 'unknown'}`,
            'success',
          );
        } else if (msg.includes('environment variable') && msg.includes('not documented in')) {
          setFlashEnv(true);
          setTimeout(() => setFlashEnv(false), 1500);
          const varMatch = f.message.match(/variable 'process\.env\.([^']+)'/i);
          onToast?.(
            `Environment variable ${varMatch?.[1] ?? 'UNKNOWN'} successfully documented in .env.example`,
            'success',
          );
        } else if (
          msg.includes('stripe webhook endpoint') &&
          msg.includes('signature verification')
        ) {
          setFlashStripe(true);
          setTimeout(() => setFlashStripe(false), 1500);
          onToast?.('Stripe webhook signature verification successfully added!', 'success');
        } else if (msg.includes("client component ('use client') imports server-side module")) {
          setFlashStripe(true);
          setTimeout(() => setFlashStripe(false), 1500);
          const moduleMatch = f.message.match(/database client '([^']+)'/i);
          onToast?.(
            `Server-side import of '${moduleMatch?.[1] ?? 'module'}' commented out to prevent credential leaks.`,
            'success',
          );
        }
      } else if (filePath.endsWith('.sql') && msg.includes('row-level security')) {
        const tableMatch = f.message.match(/table '([^']+)'/i);
        const tableName = tableMatch?.[1] ?? 'unknown';
        const baseSql =
          undoEntry.mode === 'sql' ? (undoEntry.content.sql ?? sqlContent) : sqlContent;
        setSqlContent(appendRlsFix(baseSql, tableName));
        setFlashSql(true);
        setTimeout(() => setFlashSql(false), 1500);
        onToast?.(
          `Row-Level Security (RLS) successfully enabled for table: ${tableName}`,
          'success',
        );
      } else if (msg.includes('environment variable') && msg.includes('not documented in')) {
        const varMatch = f.message.match(/variable 'process\.env\.([^']+)'/i);
        const varName = varMatch?.[1] ?? 'UNKNOWN';
        const baseEnv =
          undoEntry.mode === 'env'
            ? (undoEntry.content.envExample ?? envExampleContent)
            : envExampleContent;
        const [updated] = applyEnvVarsToExampleFiles(
          [{ path: envExampleFileName ?? '.env.example', content: baseEnv }],
          [varName],
        );
        setEnvExampleContent(updated?.content ?? baseEnv);
        setFlashEnv(true);
        setTimeout(() => setFlashEnv(false), 1500);
        onToast?.(
          `Environment variable ${varName} successfully documented in .env.example`,
          'success',
        );
      } else if (
        msg.includes('stripe webhook endpoint') &&
        msg.includes('signature verification')
      ) {
        const baseStripe =
          undoEntry.mode === 'stripe' ? (undoEntry.content.stripe ?? stripeContent) : stripeContent;
        setStripeContent(fixStripeWebhook(baseStripe));
        setFlashStripe(true);
        setTimeout(() => setFlashStripe(false), 1500);
        onToast?.('Stripe webhook signature verification successfully added!', 'success');
      } else if (msg.includes("client component ('use client') imports server-side module")) {
        const moduleMatch = f.message.match(/database client '([^']+)'/i);
        const moduleSpecifier = moduleMatch?.[1] ?? '';
        if (moduleSpecifier) {
          const baseStripe =
            undoEntry.mode === 'stripe'
              ? (undoEntry.content.stripe ?? stripeContent)
              : stripeContent;
          setStripeContent(fixRscDataLeak(baseStripe, moduleSpecifier));
          setFlashStripe(true);
          setTimeout(() => setFlashStripe(false), 1500);
          onToast?.(
            `Server-side import of '${moduleSpecifier}' commented out to prevent credential leaks.`,
            'success',
          );
        }
      }
      setFixingFindingId(null);
    }, 800);
  };

  const handleApplyAllFixes = (): void => {
    if (activeTab !== 'project' || projectFiles.length === 0) return;

    const fixableCount = countFixableFindings(results.findings);
    if (fixableCount === 0) {
      onToast?.('No auto-fixable issues were found in this project.', 'info');
      return;
    }

    const undoEntry: ShipLoopUndoEntry = {
      mode: 'project',
      files: cloneProjectFilesForUndo(projectFiles),
      fixes: [...appliedFixes],
    };

    setIsApplyingAllFixes(true);
    setTimeout(() => {
      const result = applyAllFixableFindingsToProject(undoEntry.files, results.findings);
      const remainingErrors = countShipGateBlockers(scanProject(result.files).findings);
      const batchCards = describeBatchAppliedFixes(
        result,
        result.files
          .filter((file, _index, all) => {
            const before = new Map(undoEntry.files.map((item) => [item.path, item.content]));
            return before.get(file.path) !== file.content;
          })
          .map((file) => file.path),
      );

      setUndoStack((stack) => pushUndoEntry(stack, undoEntry));
      setAppliedFixes((prev) => [...prev, ...batchCards]);
      setProjectFiles(result.files);
      setProjectHasLocalChanges(true);
      setFlashEnv(true);
      setFlashSql(true);
      setFlashStripe(true);
      setTimeout(() => {
        setFlashEnv(false);
        setFlashSql(false);
        setFlashStripe(false);
      }, 1500);

      onToast?.(
        buildBatchFixToastMessage(result, remainingErrors),
        remainingErrors === 0 ? 'success' : 'info',
      );
      setIsApplyingAllFixes(false);
    }, 800);
  };

  const handleDownloadProjectZip = (): void => {
    void downloadProjectZip(projectFiles, projectName).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : 'Unknown error';
      onToast?.(`Failed to export ZIP: ${message}`, 'info');
    });
  };

  const handleDownloadProjectPatch = (): void => {
    if (!projectSnapshotRef.current) {
      onToast?.('Load a project before exporting a patch.', 'info');
      return;
    }

    downloadProjectPatch(projectSnapshotRef.current, projectFiles, projectName);
    onToast?.('Patch file downloaded. Apply it in your local repo with git apply.', 'success');
  };

  // Drag & drop handlers
  const handleDragEnter = (e: React.DragEvent): void => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current++;
    if (e.dataTransfer.items && e.dataTransfer.items.length > 0) {
      setDragActive(true);
    }
  };

  const handleDragLeave = (e: React.DragEvent): void => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current--;
    if (dragCounter.current === 0) {
      setDragActive(false);
    }
  };

  const handleDragOver = (e: React.DragEvent): void => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleSelectFolder = (): void => {
    if (projectLoad) return;
    // Prefer the native directory input — it keeps the user gesture attached to the
    // click and works reliably across browsers (including automation edge cases).
    folderInputRef.current?.click();
  };

  const applyProjectSelection = (files: ProjectFile[], name: string): void => {
    if (files.length === 0) {
      onToast?.(`No supported code files found in "${name}"`, 'info');
      return;
    }

    const overview = buildProjectScanOverview(files, scanProject(files).findings);

    setProjectFiles(files);
    projectSnapshotRef.current = files.map((file) => ({ ...file }));
    setProjectHasLocalChanges(false);
    setProjectName(name);
    setActiveTab('project');
    setSelectedProjectPath(overview.initialFilePath);
    clearShipLoop();

    const summary =
      overview.errorCount > 0
        ? `${overview.errorCount} blocker${overview.errorCount === 1 ? '' : 's'}`
        : overview.reviewCount > 0 || overview.warningCount > 0
          ? `${overview.reviewCount + overview.warningCount} review item${
              overview.reviewCount + overview.warningCount === 1 ? '' : 's'
            }`
          : 'no issues detected';

    onToast?.(`Project "${name}" loaded (${files.length} files, ${summary})`, 'success');
  };

  const handleFolderInputChange = async (e: React.ChangeEvent<HTMLInputElement>): Promise<void> => {
    const selectedFiles = Array.from(e.target.files ?? []);
    e.target.value = '';
    if (selectedFiles.length === 0 || projectLoad) return;

    const relativePath = selectedFiles[0]?.webkitRelativePath ?? '';
    const label = relativePath.split('/')[0] || 'selected folder';
    setProjectLoad({ kind: 'folder', label });
    setActiveTab('project');

    try {
      const { files, rootFolderName } = await readFileListFromInput(selectedFiles);
      applyProjectSelection(files, rootFolderName);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      onToast?.(`Failed to open directory: ${message}`, 'info');
    } finally {
      setProjectLoad(null);
    }
  };

  const handleZipFileChange = async (e: React.ChangeEvent<HTMLInputElement>): Promise<void> => {
    const archive = e.target.files?.[0];
    e.target.value = '';
    if (!archive || projectLoad) return;

    setProjectLoad({ kind: 'zip', label: archive.name });
    setActiveTab('project');

    try {
      const files = await readZipFile(archive);
      applyProjectSelection(files, archive.name.replace(/\.zip$/i, ''));
    } catch (err) {
      onToast?.(`Failed to parse ZIP archive: ${(err as Error).message}`, 'info');
    } finally {
      setProjectLoad(null);
    }
  };

  const handleDrop = async (e: React.DragEvent): Promise<void> => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    dragCounter.current = 0;
    if (projectLoad) return;

    const items = e.dataTransfer.items;
    if (items && items.length > 0) {
      const item = items[0].webkitGetAsEntry() as FileSystemEntry | null;
      if (item) {
        if (item.isDirectory) {
          setProjectLoad({ kind: 'drop', label: item.name });
          setActiveTab('project');
          try {
            const files = await readDroppedEntry(item);
            applyProjectSelection(files, item.name);
          } catch (err) {
            onToast?.(`Failed to read dropped folder: ${(err as Error).message}`, 'info');
          } finally {
            setProjectLoad(null);
          }
          return;
        } else if (item.isFile) {
          const file = e.dataTransfer.files[0];
          if (file && file.name.endsWith('.zip')) {
            setProjectLoad({ kind: 'zip', label: file.name });
            setActiveTab('project');
            try {
              const files = await readZipFile(file);
              applyProjectSelection(files, file.name.replace(/\.zip$/i, ''));
            } catch (err) {
              onToast?.(`Failed to read ZIP archive: ${(err as Error).message}`, 'info');
            } finally {
              setProjectLoad(null);
            }
            return;
          }
        }
      }
    }

    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      const file = e.dataTransfer.files[0];
      const text = await file.text();

      if (file.name.endsWith('.sql')) {
        setSqlContent(text);
        setSqlFileName(file.name);
        setActiveTab('sql');
        onToast?.(`SQL migration "${file.name}" loaded`, 'success');
      } else if (
        file.name.includes('stripe') ||
        file.name.endsWith('.ts') ||
        file.name.endsWith('.tsx') ||
        file.name.endsWith('.js') ||
        file.name.endsWith('.jsx')
      ) {
        if (
          text.includes('stripe') &&
          (text.includes('webhook') || file.name.includes('webhook') || file.name.includes('route'))
        ) {
          setStripeContent(text);
          setStripeFileName(file.name);
          setActiveTab('stripe');
          onToast?.(`Stripe webhook "${file.name}" loaded`, 'success');
        } else {
          setEnvCodeContent(text);
          setEnvCodeFileName(file.name);
          setActiveTab('env');
          onToast?.(`Code file "${file.name}" loaded for env analysis`, 'success');
        }
      } else if (file.name.includes('.env')) {
        setEnvExampleContent(text);
        setEnvExampleFileName(file.name);
        setActiveTab('env');
        onToast?.(`Env template "${file.name}" loaded`, 'success');
      } else {
        onToast?.(`File "${file.name}" is not supported for analysis`, 'info');
      }
    }
  };

  const getTabFiles = (): string[] => {
    if (activeTab === 'sql') return [sqlFileName || 'schema.sql'];
    if (activeTab === 'stripe') return [stripeFileName || 'route.ts'];
    if (activeTab === 'env')
      return [envExampleFileName || '.env.example', envCodeFileName || 'code.ts'];

    return [];
  };

  const projectScanOverview =
    activeTab === 'project' && projectFiles.length > 0
      ? buildProjectScanOverview(projectFiles, results.findings)
      : null;

  const projectDiagnosticScan =
    projectScanOverview && activeTab === 'project'
      ? {
          fileStats: projectScanOverview.fileStats,
          metrics: buildScanMetricSummary(results.findings, projectScanOverview.fileStats),
          issueGroups: buildIssueGroupSummaries(results.findings),
        }
      : undefined;

  const projectFixableCount = activeTab === 'project' ? countFixableFindings(results.findings) : 0;

  const sandboxLayoutClass =
    activeTab === 'project' && projectFiles.length > 0
      ? 'sandbox-body sandbox-body--project'
      : 'sandbox-body';

  return (
    <div
      className="manual-checker"
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Drop overlay */}
      {dragActive && (
        <div className="manual-checker-drop-overlay">
          <div className="manual-checker-drop-box">
            <span style={{ fontSize: '2rem' }}>📥</span>
            <p>Drop your file here to scan</p>
            <span style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)' }}>
              Supported: .sql, .env, .ts, .js, .tsx, .jsx
            </span>
          </div>
        </div>
      )}

      <ManualCheckerNavigation activeTab={activeTab} onChange={setActiveTab} />

      <div className={sandboxLayoutClass}>
        {/* Input Editor */}
        <div
          className="editor-box"
          id={`manual-panel-${activeTab}`}
          role="tabpanel"
          aria-labelledby={`manual-tab-${activeTab}`}
          tabIndex={0}
        >
          {activeTab === 'sql' && (
            <>
              <div className="editor-label">
                <span>Supabase SQL Migrations</span>
                {sqlFileName ? (
                  <span className="file-badge">
                    📄 {sqlFileName}
                    <button
                      type="button"
                      className="clear-file-btn"
                      aria-label={`Clear ${sqlFileName}`}
                      onClick={() => {
                        setSqlContent(DEFAULT_SQL_MOCK);
                        setSqlFileName(null);
                      }}
                    >
                      ×
                    </button>
                  </span>
                ) : (
                  <span style={{ color: 'var(--text-muted)' }}>Paste schema script</span>
                )}
              </div>
              <label className="visually-hidden" htmlFor="manual-sql-editor">
                Supabase SQL migration source
              </label>
              <textarea
                id="manual-sql-editor"
                className={`code-textarea ${flashSql ? 'flash-success' : ''}`}
                value={sqlContent}
                onChange={(e) => setSqlContent(e.target.value)}
              />
            </>
          )}

          {activeTab === 'stripe' && (
            <>
              <div className="editor-label">
                <span>Stripe &amp; API Code (Webhooks, RSC, Cold Starts)</span>
                {stripeFileName ? (
                  <span className="file-badge">
                    📄 {stripeFileName}
                    <button
                      type="button"
                      className="clear-file-btn"
                      aria-label={`Clear ${stripeFileName}`}
                      onClick={() => {
                        setStripeContent(DEFAULT_STRIPE_MOCK);
                        setStripeFileName(null);
                      }}
                    >
                      ×
                    </button>
                  </span>
                ) : (
                  <span style={{ color: 'var(--text-muted)' }}>Paste route handler</span>
                )}
              </div>
              <label className="visually-hidden" htmlFor="manual-stripe-editor">
                Stripe and API source code
              </label>
              <textarea
                id="manual-stripe-editor"
                className={`code-textarea ${flashStripe ? 'flash-success' : ''}`}
                value={stripeContent}
                onChange={(e) => setStripeContent(e.target.value)}
              />
            </>
          )}

          {activeTab === 'env' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div>
                <div className="editor-label">
                  <span>.env.example</span>
                  {envExampleFileName ? (
                    <span className="file-badge">
                      📄 {envExampleFileName}
                      <button
                        type="button"
                        className="clear-file-btn"
                        aria-label={`Clear ${envExampleFileName}`}
                        onClick={() => {
                          setEnvExampleContent(DEFAULT_ENV_EXAMPLE_MOCK);
                          setEnvExampleFileName(null);
                        }}
                      >
                        ×
                      </button>
                    </span>
                  ) : null}
                </div>
                <label className="visually-hidden" htmlFor="manual-env-example-editor">
                  Environment variable template
                </label>
                <textarea
                  id="manual-env-example-editor"
                  className={`code-textarea ${flashEnv ? 'flash-success' : ''}`}
                  style={{ height: '110px' }}
                  value={envExampleContent}
                  onChange={(e) => setEnvExampleContent(e.target.value)}
                />
              </div>
              <div>
                <div className="editor-label">
                  <span>Source Code Snippet (process.env usage)</span>
                  {envCodeFileName ? (
                    <span className="file-badge">
                      📄 {envCodeFileName}
                      <button
                        type="button"
                        className="clear-file-btn"
                        aria-label={`Clear ${envCodeFileName}`}
                        onClick={() => {
                          setEnvCodeContent(DEFAULT_ENV_CODE_MOCK);
                          setEnvCodeFileName(null);
                        }}
                      >
                        ×
                      </button>
                    </span>
                  ) : null}
                </div>
                <label className="visually-hidden" htmlFor="manual-env-code-editor">
                  Source code using environment variables
                </label>
                <textarea
                  id="manual-env-code-editor"
                  className="code-textarea"
                  style={{ height: '140px' }}
                  value={envCodeContent}
                  onChange={(e) => setEnvCodeContent(e.target.value)}
                />
              </div>
            </div>
          )}

          {activeTab === 'project' && (
            <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
              {projectFiles.length === 0 ? (
                <div
                  className="empty-project-placeholder"
                  aria-busy={projectLoad ? true : undefined}
                >
                  {projectLoad ? (
                    <ProjectLoadStatus
                      kind={projectLoad.kind}
                      label={projectLoad.label}
                      variant="placeholder"
                    />
                  ) : (
                    <>
                      <div className="placeholder-icon" aria-hidden="true">
                        <DashboardFolderIcon className="dashboard-icon--xl" />
                      </div>
                      <h4>Scan Local Project Workspace</h4>
                      <p>
                        Analyze a whole directory or a ZIP archive locally. All operations run 100%
                        in-browser. Your proprietary code never leaves your computer.
                      </p>
                      <div className="placeholder-actions">
                        <button
                          type="button"
                          className="project-action-btn primary"
                          onClick={handleSelectFolder}
                          disabled={Boolean(projectLoad)}
                        >
                          <DashboardFolderIcon />
                          Select Project Folder
                        </button>
                        <button
                          type="button"
                          className="project-action-btn secondary"
                          onClick={() => {
                            if (projectLoad) return;
                            zipInputRef.current?.click();
                          }}
                          disabled={Boolean(projectLoad)}
                        >
                          <DashboardArchiveIcon />
                          Upload ZIP Archive
                        </button>
                      </div>
                    </>
                  )}
                  <input
                    type="file"
                    ref={folderInputRef}
                    // @ts-expect-error Non-standard directory picker attributes for folder selection.
                    webkitdirectory=""
                    directory=""
                    multiple
                    onChange={(event) => void handleFolderInputChange(event)}
                    style={{ display: 'none' }}
                    aria-label="Select project folder"
                    tabIndex={-1}
                    disabled={Boolean(projectLoad)}
                  />
                  <input
                    type="file"
                    ref={zipInputRef}
                    accept=".zip"
                    onChange={(event) => void handleZipFileChange(event)}
                    style={{ display: 'none' }}
                    aria-label="Upload ZIP archive"
                    tabIndex={-1}
                    disabled={Boolean(projectLoad)}
                  />
                </div>
              ) : (
                <ProjectWorkspaceView
                  projectName={projectName}
                  projectFiles={projectFiles}
                  selectedProjectPath={selectedProjectPath}
                  scanResults={results}
                  fixableCount={projectFixableCount}
                  isApplyingAllFixes={isApplyingAllFixes}
                  canExportPatch={projectHasLocalChanges}
                  projectLoad={projectLoad}
                  onFixAll={handleApplyAllFixes}
                  onDownloadZip={handleDownloadProjectZip}
                  onDownloadPatch={handleDownloadProjectPatch}
                  onSelectFile={setSelectedProjectPath}
                  onUpdateFileContent={(path, content) => {
                    setProjectFiles((prev) =>
                      prev.map((file) => (file.path === path ? { ...file, content } : file)),
                    );
                    setProjectHasLocalChanges(true);
                  }}
                  onClearProject={() => {
                    setProjectFiles([]);
                    setProjectName('');
                    setSelectedProjectPath(null);
                    projectSnapshotRef.current = null;
                    setProjectHasLocalChanges(false);
                    clearShipLoop();
                  }}
                />
              )}
            </div>
          )}
        </div>

        <DiagnosticTerminal
          activeTab={activeTab}
          scannedFileLabels={getTabFiles()}
          projectScan={projectDiagnosticScan}
          results={results}
          selectedProjectPath={selectedProjectPath}
          isFindingFixable={isFindingFixable}
          fixingFindingId={fixingFindingId}
          fixableCount={projectFixableCount}
          isApplyingAllFixes={isApplyingAllFixes}
          onApplyFix={handleApplyFix}
          onFixAll={activeTab === 'project' ? handleApplyAllFixes : undefined}
          appliedFixes={appliedFixes}
          shipLoopProjectName={
            activeTab === 'project' && projectName.trim()
              ? projectName
              : activeTab === 'sql'
                ? 'SQL snippet scan'
                : activeTab === 'stripe'
                  ? 'Stripe snippet scan'
                  : activeTab === 'env'
                    ? 'Env snippet scan'
                    : 'snippet scan'
          }
          onUndoLastFix={handleUndoLastFix}
        />
      </div>
    </div>
  );
}
