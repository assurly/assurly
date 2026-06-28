import { describe, expect, it } from 'vitest';
import {
  buildIssueGroupSummaries,
  buildProjectScanOverview,
  buildScanMetricSummary,
  pickInitialProjectFile,
  scanProject,
} from './projectWorkspace';
import type { ProjectFile } from './useManualScan';

const SQL_WITHOUT_RLS: ProjectFile = {
  path: 'demo/schema.sql',
  content: 'create table users (id uuid primary key);',
};

const CLEAN_ENV: ProjectFile = {
  path: 'demo/.env.example',
  content: 'PORT=3000\n',
};

const CODE_WITH_ENV: ProjectFile = {
  path: 'demo/src/route.ts',
  content: 'const key = process.env.STRIPE_SECRET_KEY;\nexport const route = key;',
};

const TEST_WITH_ENV: ProjectFile = {
  path: 'demo/src/route.test.ts',
  content: 'const key = process.env.STRIPE_SECRET_KEY;\nexport const test = key;',
};

describe('projectWorkspace', () => {
  it('opens the first file with an error instead of a clean env template', () => {
    const files = [CLEAN_ENV, SQL_WITHOUT_RLS];
    const scan = scanProject(files);

    expect(pickInitialProjectFile(files, scan.findings)).toBe('demo/schema.sql');
  });

  it('summarizes scan health and prioritizes issue files', () => {
    const files = [CLEAN_ENV, SQL_WITHOUT_RLS];
    const scan = scanProject(files);
    const overview = buildProjectScanOverview(files, scan.findings);

    expect(overview.verdict).toBe('failed');
    expect(overview.errorCount).toBeGreaterThan(0);
    expect(overview.cleanFileCount).toBe(1);
    expect(overview.initialFilePath).toBe('demo/schema.sql');
    expect(overview.fileStats[0]?.path).toBe('demo/schema.sql');
    expect(overview.fileStats[0]?.status).toBe('error');
  });

  it('groups repeated env findings into unique root causes', () => {
    const files = [CLEAN_ENV, CODE_WITH_ENV, TEST_WITH_ENV];
    const scan = scanProject(files);
    const groups = buildIssueGroupSummaries(scan.findings);
    const metrics = buildScanMetricSummary(
      scan.findings,
      buildProjectScanOverview(files, scan.findings).fileStats,
    );

    expect(groups.some((group) => group.label.includes('STRIPE_SECRET_KEY'))).toBe(true);
    expect(metrics.totalErrorFindings).toBeGreaterThan(metrics.uniqueErrorCount);
    expect(metrics.testAffectedFileCount).toBeGreaterThan(0);
    expect(metrics.productionAffectedFileCount).toBeGreaterThan(0);
  });
});
