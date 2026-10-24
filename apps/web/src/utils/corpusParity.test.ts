import * as fs from 'fs';
import * as path from 'path';
import { findingKind } from '@assurly/scanner-core';
import { describe, expect, it } from 'vitest';
import {
  dashboardCoverageFindings,
  dashboardScanScope,
  dashboardShipGate,
  loadDashboardManifests,
  planDashboardScan,
  runDashboardRules,
  type TreeEntry,
} from './dashboardScanEngine';
import type { WebFinding } from './browserScanner';
import {
  buildProjectScanOverview,
  scanProject,
} from '../app/dashboard/_components/manual-checker/projectWorkspace';
import { buildShipGateFromWebFindings } from './shipGate';

/**
 * The precision corpus, scanned the way the web app scans a project: the
 * dashboard's Instant Gate (also the landing page's free scan) and Manual
 * Checker's uploaded-folder scan. packages/cli/src/corpus.test.ts holds the
 * CLI to each case's expected answer; this holds both web channels to the
 * same answer, so no verdict a user sees can drift from the CLI and CI.
 */

const CORPUS_ROOT = path.resolve(__dirname, '../../../../test-projects/corpus');

interface ExpectedIssue {
  ruleId: string;
  severity: 'error' | 'warning';
  file?: string;
  line?: number;
}

interface ExpectedAnswer {
  verdict: { status: string; headline: string; shipScore: number; partialCoverage: boolean };
  issues: ExpectedIssue[];
  knownFalsePositives: ExpectedIssue[];
  coverage: string[];
  advisories: string[];
  /** Where the dashboard knowingly differs from the CLI; see the corpus README. */
  dashboard?: Partial<Omit<ExpectedAnswer, 'dashboard'>>;
}

function issueKey(issue: ExpectedIssue): string {
  return [issue.ruleId, issue.severity, issue.file ?? '-', issue.line ?? '-'].join(' · ');
}

function missingFrom(wanted: readonly string[], present: readonly string[]): string[] {
  const remaining = [...present];
  return wanted.filter((key) => {
    const index = remaining.indexOf(key);
    if (index === -1) return true;
    remaining.splice(index, 1);
    return false;
  });
}

const sortedUnique = (values: readonly string[]): string[] => [...new Set(values)].sort();

/** Every file in the case, as GitHub's recursive tree lists a repository. */
function treeOf(root: string): TreeEntry[] {
  const entries: TreeEntry[] = [];
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const absolute = path.join(dir, entry.name);
      const relative = path.relative(root, absolute).split(path.sep).join('/');
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === '.git') continue;
        entries.push({ path: relative, type: 'tree' });
        walk(absolute);
      } else if (entry.isFile()) {
        entries.push({ path: relative, type: 'blob' });
      }
    }
  };
  walk(root);
  return entries;
}

async function scanLikeTheDashboard(root: string) {
  const plan = planDashboardScan(treeOf(root));
  const load = async (file: string): Promise<string | null> => {
    try {
      return fs.readFileSync(path.join(root, file), 'utf8');
    } catch {
      return null;
    }
  };
  const scanScope = dashboardScanScope(plan);
  const findings: WebFinding[] = [
    ...dashboardCoverageFindings(plan),
    ...(await runDashboardRules(plan, load, await loadDashboardManifests(plan, load))),
  ];
  return { findings, report: dashboardShipGate(findings, plan, scanScope) };
}

/** Every file in the case, as Manual Checker reads an uploaded project folder. */
function scanLikeManualChecker(root: string) {
  const files = treeOf(root)
    .filter((entry) => entry.type === 'blob')
    .map((entry) => ({
      path: entry.path,
      content: fs.readFileSync(path.join(root, entry.path), 'utf8'),
    }));
  const { findings } = scanProject(files);
  const overview = buildProjectScanOverview(files, findings);
  // DiagnosticTerminal's project-mode report, before it localises the copy.
  const report = buildShipGateFromWebFindings(findings, {
    scannedFileCount: overview.scannedFileCount,
    cleanFileCount: overview.cleanFileCount,
  });
  return { findings, report };
}

const CHANNELS = {
  dashboard: scanLikeTheDashboard,
  'manual checker': async (root: string) => scanLikeManualChecker(root),
} as const;

const caseNames = fs
  .readdirSync(CORPUS_ROOT, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

describe('precision corpus, as the web app scans it', () => {
  it('finds the corpus', () => {
    expect(caseNames.length).toBeGreaterThanOrEqual(4);
  });

  const cases = Object.keys(CHANNELS).flatMap((channel) =>
    caseNames.map((name) => [channel as keyof typeof CHANNELS, name] as const),
  );

  it.each(cases)('%s · %s', async (channel, name) => {
    const answer = JSON.parse(
      fs.readFileSync(path.join(CORPUS_ROOT, `${name}.expected.json`), 'utf8'),
    ) as ExpectedAnswer;
    const expected = { ...answer, ...answer.dashboard };
    const { findings, report } = await CHANNELS[channel](path.join(CORPUS_ROOT, name));

    const reported = findings
      .filter((finding) => findingKind(finding) === 'issue')
      .map((finding) =>
        issueKey({
          ruleId: finding.ruleId,
          severity: finding.severity,
          file: finding.file,
          line: finding.line,
        }),
      );
    const listed = [...expected.issues, ...expected.knownFalsePositives].map(issueKey);

    expect({
      falsePositives: missingFrom(reported, listed),
      missedDefects: missingFrom(expected.issues.map(issueKey), reported),
      fixedKnownFalsePositives: missingFrom(expected.knownFalsePositives.map(issueKey), reported),
    }).toEqual({ falsePositives: [], missedDefects: [], fixedKnownFalsePositives: [] });

    expect({
      status: report.status,
      headline: report.headline,
      shipScore: report.shipScore,
      partialCoverage: report.partialCoverage ?? false,
    }).toEqual(expected.verdict);

    const ruleIdsOfKind = (kind: 'coverage' | 'advisory'): string[] =>
      sortedUnique(findings.filter((f) => findingKind(f) === kind).map((f) => f.ruleId));
    expect(ruleIdsOfKind('coverage')).toEqual(sortedUnique(expected.coverage));
    expect(ruleIdsOfKind('advisory')).toEqual(sortedUnique(expected.advisories));
  });
});
