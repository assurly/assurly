// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DiagnosticTerminal } from './DiagnosticTerminal';
import {
  buildIssueGroupSummaries,
  buildProjectScanOverview,
  buildScanMetricSummary,
} from './projectWorkspace';
import type { ProjectFile } from './useManualScan';
import { scanSqlMigration, type WebFinding } from '../../../../utils/browserScanner';
import { describeAppliedFix, resetShipLoopFixIdCounterForTests } from './shipLoopJournal';

afterEach(() => {
  cleanup();
});

beforeEach(() => {
  resetShipLoopFixIdCounterForTests();
});

/** Shared, correctly-typed finding fixtures used across the terminal specs. */
const rlsFinding = (file = 'demo/schema.sql'): WebFinding => ({
  ruleId: 'supabase-rls',
  severity: 'error',
  message: "Supabase table 'users' is created but Row-Level Security (RLS) is not enabled.",
  file,
  line: 1,
});

const undocumentedEnvFinding = (): WebFinding => ({
  ruleId: 'undocumented-env',
  severity: 'warning',
  message:
    "Environment variable 'process.env.STRIPE_SECRET_KEY' is used but not documented in '.env.example'.",
  file: 'demo/route.test.ts',
  line: 1,
});

const files: ProjectFile[] = [
  { path: 'demo/.env.example', content: 'PORT=3000\n' },
  {
    path: 'demo/schema.sql',
    content: 'create table users (id uuid primary key);',
  },
  {
    path: 'demo/route.test.ts',
    content: 'const key = process.env.STRIPE_SECRET_KEY;',
  },
];

const overview = buildProjectScanOverview(files, [rlsFinding(), undocumentedEnvFinding()]);

const projectScan = {
  fileStats: overview.fileStats,
  metrics: buildScanMetricSummary([rlsFinding(), undocumentedEnvFinding()], overview.fileStats),
  issueGroups: buildIssueGroupSummaries([rlsFinding(), undocumentedEnvFinding()]),
};

describe('DiagnosticTerminal project mode', () => {
  it('shows idle copy when no project is loaded — never READY TO SHIP', () => {
    render(
      <DiagnosticTerminal
        activeTab="project"
        scannedFileLabels={[]}
        results={{ errorCount: 0, warningCount: 0, findings: [] }}
        selectedProjectPath={null}
        isFindingFixable={() => false}
        fixingFindingId={null}
        onApplyFix={vi.fn()}
      />,
    );

    expect(screen.getByTestId('manual-checker-project-idle')).toBeTruthy();
    expect(screen.getByText('Select a folder or ZIP to start')).toBeTruthy();
    expect(screen.getByText(/Waiting for a project folder or ZIP archive/i)).toBeTruthy();
    expect(screen.queryByText('READY TO SHIP')).toBeNull();
    expect(screen.queryByText(/All scanned files passed/i)).toBeNull();
    expect(screen.queryByLabelText(/Ship Gate readiness summary/i)).toBeNull();
  });

  it('shows grouped root causes and only the active file log', () => {
    render(
      <DiagnosticTerminal
        activeTab="project"
        scannedFileLabels={[]}
        projectScan={projectScan}
        results={{
          errorCount: 1,
          warningCount: 1,
          findings: [rlsFinding(), undocumentedEnvFinding()],
        }}
        selectedProjectPath="demo/schema.sql"
        isFindingFixable={() => false}
        fixingFindingId={null}
        onApplyFix={vi.fn()}
      />,
    );

    expect(screen.getByText('Root causes')).toBeTruthy();
    expect(screen.getByText('Active file log')).toBeTruthy();
    expect(screen.getByText('demo/schema.sql')).toBeTruthy();
    const activeLog = screen.getByRole('region', { name: /Findings for demo\/schema.sql/i });
    expect(within(activeLog).getByText(/Row-Level Security/i)).toBeTruthy();
    expect(
      within(activeLog).queryByText(/Environment variable 'process.env.STRIPE_SECRET_KEY'/),
    ).toBeNull();
    expect(screen.queryByRole('button', { name: 'View file' })).toBeNull();
    expect(document.querySelector('.scan-file-block')).toBeNull();
    expect(document.querySelector('.scan-file-jump-btn')).toBeNull();
    expect(screen.getByText(/^1 Blocker$/i)).toBeTruthy();
    expect(screen.getByText(/files affected/i)).toBeTruthy();
    expect(screen.getByText('NOT READY TO SHIP')).toBeTruthy();
    expect(screen.getByText(/Fix blocking errors in the workspace above/i)).toBeTruthy();
  });

  it('aligns the metric badge with Ship Gate blockers when findings are grouped', () => {
    const sameTableA = rlsFinding('demo/a.sql');
    const sameTableB = rlsFinding('demo/b.sql');
    const groupedFiles: ProjectFile[] = [
      { path: 'demo/a.sql', content: 'create table users (id uuid primary key);' },
      { path: 'demo/b.sql', content: 'create table users (id uuid primary key);' },
    ];
    const groupedOverview = buildProjectScanOverview(groupedFiles, [sameTableA, sameTableB]);
    const groupedScan = {
      fileStats: groupedOverview.fileStats,
      metrics: buildScanMetricSummary([sameTableA, sameTableB], groupedOverview.fileStats),
      issueGroups: buildIssueGroupSummaries([sameTableA, sameTableB]),
    };

    render(
      <DiagnosticTerminal
        activeTab="project"
        scannedFileLabels={[]}
        projectScan={groupedScan}
        results={{
          errorCount: 2,
          warningCount: 0,
          findings: [sameTableA, sameTableB],
        }}
        selectedProjectPath="demo/a.sql"
        isFindingFixable={() => false}
        fixingFindingId={null}
        onApplyFix={vi.fn()}
      />,
    );

    // Two raw errors in the file log, one Ship Gate blocker group.
    expect(screen.getByText(/^1 Blocker$/i)).toBeTruthy();
    expect(screen.getByText(/2 in file log/i)).toBeTruthy();
    expect(screen.queryByText(/^2 Errors$/i)).toBeNull();
    expect(screen.getByText('Blockers (must fix)')).toBeTruthy();
    const blockerList = screen.getByText('Blockers (must fix)').closest('.ship-gate-group');
    expect(blockerList?.querySelectorAll('.ship-gate-list > li').length).toBe(1);
  });

  it('snippet-mode badge uses Ship Gate blocker count, not raw error findings', () => {
    const sameTableA = rlsFinding('schema.sql');
    const sameTableB: WebFinding = {
      ...rlsFinding('schema.sql'),
      line: 12,
    };

    render(
      <DiagnosticTerminal
        activeTab="sql"
        scannedFileLabels={['schema.sql']}
        results={{
          errorCount: 2,
          warningCount: 0,
          findings: [sameTableA, sameTableB],
        }}
        selectedProjectPath={null}
        isFindingFixable={() => false}
        fixingFindingId={null}
        onApplyFix={vi.fn()}
      />,
    );

    expect(screen.getByText(/^1 Blocker$/i)).toBeTruthy();
    expect(screen.getByText(/2 in file log/i)).toBeTruthy();
    expect(screen.queryByText(/^2 Errors$/i)).toBeNull();
  });

  it('default SQL mock scan: auth-linked RLS subsumes generic finding (1 file-log error)', () => {
    // Mirrors ManualChecker DEFAULT_SQL_MOCK — scan-time subsumption keeps one finding.
    const sql = [
      'create table profiles (',
      '  id uuid references auth.users on delete cascade primary key,',
      '  username text unique,',
      '  updated_at timestamp with time zone',
      ');',
      'create table posts (',
      '  id uuid primary key,',
      '  title text,',
      '  content text,',
      '  author_id uuid references profiles(id)',
      ');',
      'alter table posts enable row level security;',
    ].join('\n');
    const scan = scanSqlMigration(sql, 'schema.sql');
    const profilesFindings = scan.findings.filter((finding) =>
      /table 'profiles'/i.test(finding.message),
    );

    expect(profilesFindings).toHaveLength(1);
    expect(profilesFindings[0]?.ruleId).toBe('supabase-migration-auth-linked-no-rls');

    render(
      <DiagnosticTerminal
        activeTab="sql"
        scannedFileLabels={['schema.sql']}
        results={scan}
        selectedProjectPath={null}
        isFindingFixable={() => false}
        fixingFindingId={null}
        onApplyFix={vi.fn()}
      />,
    );

    expect(screen.getByText(/^1 Blocker$/i)).toBeTruthy();
    expect(screen.queryByText(/2 in file log/i)).toBeNull();
    expect(screen.getByText('Blockers (must fix)')).toBeTruthy();
    const blockerList = screen.getByText('Blockers (must fix)').closest('.ship-gate-group');
    expect(blockerList?.querySelectorAll('.ship-gate-list > li').length).toBe(1);
  });

  it('updates the active file log when the selected file changes', () => {
    const { rerender } = render(
      <DiagnosticTerminal
        activeTab="project"
        scannedFileLabels={[]}
        projectScan={projectScan}
        results={{
          errorCount: 1,
          warningCount: 1,
          findings: [rlsFinding(), undocumentedEnvFinding()],
        }}
        selectedProjectPath="demo/schema.sql"
        isFindingFixable={() => false}
        fixingFindingId={null}
        onApplyFix={vi.fn()}
      />,
    );

    rerender(
      <DiagnosticTerminal
        activeTab="project"
        scannedFileLabels={[]}
        projectScan={projectScan}
        results={{
          errorCount: 1,
          warningCount: 1,
          findings: [rlsFinding(), undocumentedEnvFinding()],
        }}
        selectedProjectPath="demo/route.test.ts"
        isFindingFixable={() => false}
        fixingFindingId={null}
        onApplyFix={vi.fn()}
      />,
    );

    const activeLog = screen.getByRole('region', { name: /Findings for demo\/route.test.ts/i });
    expect(within(activeLog).getByText(/STRIPE_SECRET_KEY/)).toBeTruthy();
    expect(within(activeLog).queryByText(/Row-Level Security/i)).toBeNull();
  });

  it('labels auto-fix buttons with file context for accessibility', () => {
    render(
      <DiagnosticTerminal
        activeTab="project"
        scannedFileLabels={[]}
        projectScan={projectScan}
        results={{
          errorCount: 1,
          warningCount: 0,
          findings: [rlsFinding()],
        }}
        selectedProjectPath="demo/schema.sql"
        isFindingFixable={() => true}
        fixingFindingId={null}
        onApplyFix={vi.fn()}
      />,
    );

    expect(
      screen.getByRole('button', { name: /Auto-fix error in demo\/schema.sql at line 1/i }),
    ).toBeTruthy();
  });

  it('does not shrink diagnostic rows in a flex terminal container', () => {
    render(
      <DiagnosticTerminal
        activeTab="project"
        scannedFileLabels={[]}
        projectScan={projectScan}
        results={{ errorCount: 2, warningCount: 0, findings: [] }}
        selectedProjectPath="demo/schema.sql"
        isFindingFixable={() => false}
        fixingFindingId={null}
        onApplyFix={vi.fn()}
      />,
    );

    const activePanel = document.querySelector('.active-file-findings');
    const terminalBody = document.querySelector('.diagnostic-terminal-body');
    expect(activePanel).toBeTruthy();
    expect(terminalBody).toBeTruthy();
    expect(document.querySelector('.scan-file-block')).toBeNull();
    expect(document.querySelector('.scan-file-jump-btn')).toBeNull();
  });

  it('shows bulk auto-fix action when fixable findings exist', () => {
    const onFixAll = vi.fn();
    const findings = [rlsFinding(), undocumentedEnvFinding()];

    render(
      <DiagnosticTerminal
        activeTab="project"
        scannedFileLabels={[]}
        projectScan={projectScan}
        results={{ errorCount: 2, warningCount: 0, findings }}
        selectedProjectPath="demo/schema.sql"
        isFindingFixable={() => true}
        fixingFindingId={null}
        fixableCount={2}
        onApplyFix={vi.fn()}
        onFixAll={onFixAll}
      />,
    );

    const bulkButton = screen.getByRole('button', {
      name: /Fix all auto-fixable issues \(2\)/i,
    });
    fireEvent.click(bulkButton);
    expect(onFixAll).toHaveBeenCalledTimes(1);
  });
});

describe('DiagnosticTerminal snippet mode', () => {
  it('keeps per-file findings for single-file tabs', () => {
    render(
      <DiagnosticTerminal
        activeTab="sql"
        scannedFileLabels={['schema.sql']}
        results={{
          errorCount: 1,
          warningCount: 0,
          findings: [rlsFinding('schema.sql')],
        }}
        selectedProjectPath={null}
        isFindingFixable={() => true}
        fixingFindingId={null}
        onApplyFix={vi.fn()}
      />,
    );

    expect(screen.getByText('schema.sql')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Auto-fix error in schema.sql/i }));
  });
});

describe('DiagnosticTerminal Ship Loop', () => {
  it('mounts ShipLoopPanel under Ship Gate with applied fixes and handoff', () => {
    const onUndo = vi.fn();
    const applied = [
      describeAppliedFix({
        kind: 'rls',
        detail: 'profiles',
        filePaths: ['schema.sql'],
      }),
    ];

    render(
      <DiagnosticTerminal
        activeTab="sql"
        scannedFileLabels={['schema.sql']}
        results={{
          errorCount: 1,
          warningCount: 0,
          findings: [rlsFinding('schema.sql')],
        }}
        selectedProjectPath={null}
        isFindingFixable={() => false}
        fixingFindingId={null}
        onApplyFix={vi.fn()}
        appliedFixes={applied}
        shipLoopProjectName="SQL snippet scan"
        onUndoLastFix={onUndo}
      />,
    );

    expect(screen.getByLabelText(/Ship Gate readiness summary/i)).toBeTruthy();
    expect(screen.getByTestId('ship-loop-what-changed')).toBeTruthy();
    expect(screen.getByTestId('ship-loop-handoff')).toBeTruthy();
    fireEvent.click(screen.getByTestId('ship-loop-undo'));
    expect(onUndo).toHaveBeenCalledTimes(1);
  });

  it('does not mount Ship Loop while the project tab is idle', () => {
    render(
      <DiagnosticTerminal
        activeTab="project"
        scannedFileLabels={[]}
        results={{ errorCount: 0, warningCount: 0, findings: [] }}
        selectedProjectPath={null}
        isFindingFixable={() => false}
        fixingFindingId={null}
        onApplyFix={vi.fn()}
        appliedFixes={[describeAppliedFix({ kind: 'stripe', filePaths: ['route.ts'] })]}
        onUndoLastFix={vi.fn()}
      />,
    );

    expect(screen.queryByTestId('ship-loop-what-changed')).toBeNull();
    expect(screen.queryByTestId('ship-loop-handoff')).toBeNull();
  });
});
