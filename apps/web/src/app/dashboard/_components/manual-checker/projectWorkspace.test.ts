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

const FIXTURE_SQL: ProjectFile = {
  path: 'test-projects/broken-project/supabase/migrations/init.sql',
  content:
    'create table users (id uuid primary key);\nALTER TABLE users ADD COLUMN api_key TEXT NOT NULL;',
};

const FIXTURE_WEBHOOK: ProjectFile = {
  path: 'test-projects/broken-project/app/api/webhooks/route.ts',
  content: `import stripe from 'stripe';
export async function POST(req: Request) {
  const body = await req.json();
  console.log(body);
}
`,
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

  it('ignores unit-test files for Ship Gate findings while still flagging production env gaps', () => {
    const files = [CLEAN_ENV, CODE_WITH_ENV, TEST_WITH_ENV];
    const scan = scanProject(files);
    const groups = buildIssueGroupSummaries(scan.findings);
    const metrics = buildScanMetricSummary(
      scan.findings,
      buildProjectScanOverview(files, scan.findings).fileStats,
    );

    expect(groups.some((group) => group.label.includes('STRIPE_SECRET_KEY'))).toBe(true);
    expect(groups.every((group) => group.gateKind === 'warning')).toBe(true);
    expect(scan.findings.every((finding) => finding.file !== TEST_WITH_ENV.path)).toBe(true);
    expect(metrics.totalErrorFindings).toBe(0);
    expect(metrics.testAffectedFileCount).toBe(0);
    expect(metrics.productionAffectedFileCount).toBeGreaterThan(0);
  });

  it('does not treat intentional test-project fixtures as production blockers', () => {
    const files = [FIXTURE_SQL, FIXTURE_WEBHOOK, SQL_WITHOUT_RLS];
    const scan = scanProject(files);

    expect(scan.findings.some((finding) => finding.file === FIXTURE_SQL.path)).toBe(false);
    expect(scan.findings.some((finding) => finding.file === FIXTURE_WEBHOOK.path)).toBe(false);
    expect(scan.findings.some((finding) => finding.file === SQL_WITHOUT_RLS.path)).toBe(true);
    expect(scan.findings.some((finding) => finding.severity === 'error')).toBe(true);
  });

  it('resolves the nearest nested .env.example for monorepo packages', () => {
    const files: ProjectFile[] = [
      { path: '.env.example', content: 'ROOT_ONLY=1\n' },
      {
        path: 'apps/web/.env.example',
        content: 'NEXT_PUBLIC_SUPABASE_URL=\n',
      },
      {
        path: 'apps/web/src/lib/client.ts',
        content: 'export const url = process.env.NEXT_PUBLIC_SUPABASE_URL;',
      },
      {
        path: 'apps/web/src/lib/missing.ts',
        content: 'export const key = process.env.STRIPE_SECRET_KEY;',
      },
    ];
    const scan = scanProject(files);

    expect(
      scan.findings.some(
        (finding) =>
          finding.ruleId === 'undocumented-env' &&
          finding.message.includes('NEXT_PUBLIC_SUPABASE_URL'),
      ),
    ).toBe(false);
    expect(
      scan.findings.some(
        (finding) =>
          finding.ruleId === 'undocumented-env' &&
          finding.file === 'apps/web/src/lib/missing.ts' &&
          finding.message.includes('STRIPE_SECRET_KEY'),
      ),
    ).toBe(true);
  });

  it('points package env gaps at package-local .env.example and ignores Actions runtime keys', () => {
    const files: ProjectFile[] = [
      {
        path: 'shipready/apps/web/.env.example',
        content: 'NEXT_PUBLIC_SUPABASE_URL=\n',
      },
      {
        path: 'shipready/packages/cli/src/index.ts',
        content: [
          'export const url = process.env.ASSURLY_API_URL;',
          'export const key = process.env.ASSURLY_API_KEY;',
        ].join('\n'),
      },
      {
        path: 'shipready/packages/github-action/src/runtime.ts',
        content: [
          'const out = process.env.GITHUB_OUTPUT;',
          'const summary = process.env.GITHUB_STEP_SUMMARY;',
        ].join('\n'),
      },
    ];
    const scan = scanProject(files);

    expect(scan.findings.some((finding) => finding.message.includes('GITHUB_OUTPUT'))).toBe(false);
    expect(scan.findings.some((finding) => finding.message.includes('GITHUB_STEP_SUMMARY'))).toBe(
      false,
    );
    expect(
      scan.findings.some(
        (finding) =>
          finding.ruleId === 'undocumented-env' &&
          finding.message.includes('ASSURLY_API_KEY') &&
          finding.message.includes('shipready/packages/cli/.env.example') &&
          !finding.message.includes('apps/web/.env.example'),
      ),
    ).toBe(true);
  });

  it('counts Ship Gate blockers, not raw error occurrences, for overview badges', () => {
    const files: ProjectFile[] = [
      {
        path: 'a.sql',
        content: 'create table users (id uuid primary key);',
      },
      {
        path: 'b.sql',
        content: 'create table users (id uuid primary key);',
      },
    ];
    const scan = scanProject(files);
    const overview = buildProjectScanOverview(files, scan.findings);
    const metrics = buildScanMetricSummary(scan.findings, overview.fileStats);

    expect(scan.findings.filter((f) => f.severity === 'error').length).toBe(2);
    expect(overview.totalErrorFindings).toBe(2);
    expect(overview.errorCount).toBe(1);
    expect(metrics.uniqueErrorCount).toBe(1);
    expect(metrics.uniqueErrorCount).toBe(overview.errorCount);
  });
});
