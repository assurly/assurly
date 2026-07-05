// @vitest-environment jsdom

import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DiagnosticTerminal } from './DiagnosticTerminal';
import {
  buildIssueGroupSummaries,
  buildProjectScanOverview,
  buildScanMetricSummary,
} from './projectWorkspace';
import type { ProjectFile } from './useManualScan';
import type { WebFinding } from '../../../../utils/browserScanner';

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
  severity: 'error',
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
  it('shows grouped root causes and only the active file log', () => {
    render(
      <DiagnosticTerminal
        activeTab="project"
        scannedFileLabels={[]}
        projectScan={projectScan}
        results={{
          errorCount: 2,
          warningCount: 0,
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
    expect(screen.getByText(/unique errors/i)).toBeTruthy();
    expect(screen.getByText(/files affected/i)).toBeTruthy();
    expect(screen.getByText('NOT READY TO SHIP')).toBeTruthy();
    expect(screen.getByText(/Fix blocking errors in the workspace above/i)).toBeTruthy();
  });

  it('updates the active file log when the selected file changes', () => {
    const { rerender } = render(
      <DiagnosticTerminal
        activeTab="project"
        scannedFileLabels={[]}
        projectScan={projectScan}
        results={{
          errorCount: 2,
          warningCount: 0,
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
          errorCount: 2,
          warningCount: 0,
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
