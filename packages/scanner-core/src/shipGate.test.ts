import { describe, expect, it } from 'vitest';
import {
  buildIssueGroups,
  buildShipGateReport,
  formatShipGateMarkdown,
  formatShipGatePlainText,
  getFindingGroupKey,
  isShipGateBlocked,
  resolveGroupAction,
  type ShipGateFindingInput,
} from './shipGate';

const blockers: ShipGateFindingInput[] = [
  {
    ruleId: 'supabase-rls',
    severity: 'error',
    file: 'schema.sql',
    line: 1,
    message: "Supabase table 'users' is created but Row-Level Security (RLS) is not enabled.",
  },
  {
    ruleId: 'undocumented-env',
    severity: 'error',
    file: 'api.ts',
    line: 2,
    message:
      "Environment variable 'process.env.STRIPE_SECRET_KEY' is used but not documented in '.env.example'.",
  },
  ...Array.from({ length: 7 }, (_, index) => ({
    ruleId: 'undocumented-env',
    severity: 'error' as const,
    file: `routes/route-${index}.ts`,
    line: 1,
    message:
      "Environment variable 'process.env.STRIPE_SECRET_KEY' is used but not documented in '.env.example'.",
  })),
  {
    ruleId: 'stripe-webhook-signature',
    severity: 'error',
    file: 'app/api/webhook/route.ts',
    line: 1,
    message: 'Stripe webhook endpoint appears to lack signature verification.',
  },
];

const warnings: ShipGateFindingInput[] = [
  {
    ruleId: 'cold-start-optimization',
    severity: 'warning',
    file: 'app/api/heavy/route.ts',
    line: 1,
    message: "Importing the entire 'lodash' library slows serverless cold starts.",
    suggestion: 'Replace with lodash-es or import only the functions you need.',
  },
  {
    ruleId: 'github-actions-integration',
    severity: 'warning',
    file: 'Global Configs',
    line: 1,
    message: 'GitHub Actions workflow for Assurly is missing.',
    suggestion:
      'Run "npx assurly init" in your repository to automatically configure the CI/CD pipeline.',
  },
];

describe('shipGate', () => {
  it('groups env findings by variable name', () => {
    expect(
      getFindingGroupKey({
        ruleId: 'undocumented-env',
        severity: 'error',
        file: 'src/a.ts',
        message:
          "Environment variable 'process.env.NEXT_PUBLIC_SENTRY_DSN' is used but not documented in '.env.example'.",
      }),
    ).toBe('env:NEXT_PUBLIC_SENTRY_DSN');
  });

  it('groups github actions findings even when rule id was lost during persistence', () => {
    expect(
      getFindingGroupKey({
        ruleId: 'general',
        severity: 'warning',
        file: 'Global Configs',
        message: 'GitHub Actions workflow for Assurly is missing.',
      }),
    ).toBe('rule:github-actions-integration');
  });

  it('groups repeated env findings into one blocker', () => {
    const groups = buildIssueGroups(blockers);
    const envGroup = groups.find((group) => group.id.startsWith('env:'));
    expect(envGroup?.affectedFileCount).toBe(8);
    expect(envGroup?.label).toBe('Undocumented env: STRIPE_SECRET_KEY');
  });

  it('builds a blocked report with score derived from unique groups', () => {
    const report = buildShipGateReport([...blockers, ...warnings], {
      scannedFileCount: 172,
      cleanFileCount: 168,
    });

    expect(report.status).toBe('blocked');
    expect(report.headline).toBe('NOT READY TO SHIP');
    expect(report.blockers).toHaveLength(3);
    expect(report.reviews).toHaveLength(0);
    expect(report.warnings).toHaveLength(2);
    expect(report.shipScore).toBe(56);
    expect(report.cleanFileCount).toBe(168);
    expect(isShipGateBlocked(report)).toBe(true);
  });

  it('classifies low-confidence errors as review, not blockers', () => {
    const report = buildShipGateReport([
      {
        ruleId: 'rsc-data-leaks',
        severity: 'error',
        confidence: 'low',
        file: 'app/ui.tsx',
        message: "Client Component imports server-side module '@/lib/db'.",
      },
    ]);

    expect(report.blockers).toHaveLength(0);
    expect(report.reviews).toHaveLength(1);
    expect(report.status).toBe('review');
    expect(isShipGateBlocked(report)).toBe(false);
  });

  it('keeps legacy error findings without confidence as blockers', () => {
    const report = buildShipGateReport([
      {
        ruleId: 'supabase-rls',
        severity: 'error',
        file: 'schema.sql',
        message: "Supabase table 'users' is created but Row-Level Security (RLS) is not enabled.",
      },
    ]);

    expect(report.blockers).toHaveLength(1);
    expect(report.reviews).toHaveLength(0);
    expect(report.status).toBe('blocked');
  });

  it('populates scanScope on the report when provided in options', () => {
    const report = buildShipGateReport([], {
      scannedFileCount: 42,
      cleanFileCount: 42,
      scanScope: { scanned: 42, skipped: 18, roots: ['apps/web'] },
    });

    expect(report.scanScope).toEqual({ scanned: 42, skipped: 18, roots: ['apps/web'] });
    expect(formatShipGatePlainText(report)).toContain('Scanned apps/web, 42 files');
  });

  it('marks warning-only scans as review with high score', () => {
    const report = buildShipGateReport(warnings.slice(0, 1), {
      scannedFileCount: 10,
      cleanFileCount: 9,
    });
    expect(report.status).toBe('review');
    expect(report.shipScore).toBe(96);
    expect(isShipGateBlocked(report)).toBe(false);
  });

  it('attaches actionable commands to CI workflow warnings', () => {
    const groups = buildIssueGroups(warnings);
    const ciGroup = groups.find((group) => group.id === 'rule:github-actions-integration');

    expect(ciGroup?.action).toEqual({
      label: 'Initialize CI workflow',
      kind: 'command',
      command: 'npx assurly init',
      hint: warnings[1]?.suggestion,
    });
  });

  it('attaches hint actions to env and RLS blockers', () => {
    const groups = buildIssueGroups(blockers);
    const envGroup = groups.find((group) => group.id.startsWith('env:'));
    const rlsGroup = groups.find((group) => group.id.startsWith('rls:'));

    expect(envGroup?.action?.kind).toBe('hint');
    expect(envGroup?.action?.hint).toContain('.env.example');
    expect(rlsGroup?.action?.kind).toBe('hint');
    expect(rlsGroup?.action?.hint).toContain('users');
  });

  it('extracts commands from suggestion text when rule is unknown', () => {
    const action = resolveGroupAction(
      'rule:custom',
      'Run "npx assurly init" in your repository root.',
      'custom',
    );

    expect(action).toEqual({
      label: 'Run locally',
      kind: 'command',
      command: 'npx assurly init',
      hint: 'Run "npx assurly init" in your repository root.',
    });
  });

  it('formats plain text and markdown summaries consistently', () => {
    const report = buildShipGateReport([...blockers, ...warnings], {
      scannedFileCount: 172,
      cleanFileCount: 168,
    });
    const plain = formatShipGatePlainText(report);
    const markdown = formatShipGateMarkdown(report, {
      repositoryName: 'acme/saas',
      reportUrl: 'https://assurly.dev/report/abc123',
    });

    expect(plain).toContain('NOT READY TO SHIP');
    expect(plain).toContain('Ship Score: 56/100');
    expect(plain).toContain('Missing RLS on table: users');
    expect(plain).toContain('✓ 168 files clean');
    expect(plain).toContain('Run: npx assurly init');

    expect(markdown).toContain('NOT READY TO SHIP');
    expect(markdown).toContain('Stripe webhook signature missing');
    expect(markdown).toContain('https://assurly.dev/report/abc123');
    expect(markdown).toContain('`npx assurly init`');
  });
});
