import { describe, expect, it } from 'vitest';
import {
  BLOCKED_SCORE_CAP,
  buildIssueGroups,
  buildShipGateReport,
  countCleanScannedFiles,
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
    ruleId: 'stripe-webhook-signature',
    severity: 'error',
    file: 'app/api/webhook/route.ts',
    line: 1,
    message: 'Stripe webhook endpoint appears to lack signature verification.',
  },
];

const envWarnings: ShipGateFindingInput[] = [
  {
    ruleId: 'undocumented-env',
    severity: 'warning',
    confidence: 'high',
    file: 'api.ts',
    line: 2,
    message:
      "Environment variable 'process.env.STRIPE_SECRET_KEY' is used but not documented in '.env.example'.",
    suggestion: 'Add STRIPE_SECRET_KEY= to .env.example.',
  },
  ...Array.from({ length: 7 }, (_, index) => ({
    ruleId: 'undocumented-env',
    severity: 'warning' as const,
    confidence: 'high' as const,
    file: `routes/route-${index}.ts`,
    line: 1,
    message:
      "Environment variable 'process.env.STRIPE_SECRET_KEY' is used but not documented in '.env.example'.",
    suggestion: 'Add STRIPE_SECRET_KEY= to .env.example.',
  })),
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
  ...envWarnings,
];

describe('shipGate', () => {
  it('groups env findings by variable name', () => {
    expect(
      getFindingGroupKey({
        ruleId: 'undocumented-env',
        severity: 'warning',
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

  it('groups repeated env findings into one warning group', () => {
    const groups = buildIssueGroups(envWarnings);
    const envGroup = groups.find((group) => group.id.startsWith('env:'));
    expect(envGroup?.affectedFileCount).toBe(8);
    expect(envGroup?.label).toBe('STRIPE_SECRET_KEY is missing from .env.example');
    expect(envGroup?.severity).toBe('warning');
    expect(envGroup?.action?.hint).toBe('Add STRIPE_SECRET_KEY= to .env.example.');
  });

  it('aggregates unique monorepo .env.example targets into the env group Copy fix hint', () => {
    const groups = buildIssueGroups([
      {
        ruleId: 'undocumented-env',
        severity: 'warning',
        confidence: 'high',
        file: 'packages/cli/src/index.ts',
        line: 46,
        message:
          "Environment variable 'process.env.ASSURLY_API_KEY' is used but not documented in 'packages/cli/.env.example'.",
        suggestion: 'Add ASSURLY_API_KEY= to packages/cli/.env.example.',
      },
      {
        ruleId: 'undocumented-env',
        severity: 'warning',
        confidence: 'high',
        file: 'packages/mcp-server/src/index.ts',
        line: 119,
        message:
          "Environment variable 'process.env.ASSURLY_API_KEY' is used but not documented in 'packages/mcp-server/.env.example'.",
        suggestion: 'Add ASSURLY_API_KEY= to packages/mcp-server/.env.example.',
      },
    ]);

    const envGroup = groups.find((group) => group.id === 'env:ASSURLY_API_KEY');
    expect(envGroup?.affectedFileCount).toBe(2);
    expect(envGroup?.action?.hint).toContain('packages/cli/.env.example');
    expect(envGroup?.action?.hint).toContain('packages/mcp-server/.env.example');
    expect(envGroup?.action?.hint?.split('\n')).toHaveLength(2);
  });

  it('does not treat undocumented-env as a ship blocker', () => {
    const report = buildShipGateReport(
      [
        {
          ruleId: 'undocumented-env',
          severity: 'warning',
          confidence: 'high',
          file: 'lib/config.ts',
          line: 1,
          message:
            "Environment variable 'process.env.NEXT_PUBLIC_BASE_PATH' is used but not documented in '.env.example'.",
        },
      ],
      { scannedFileCount: 40, cleanFileCount: 39 },
    );

    expect(report.status).toBe('review');
    expect(report.headline).toBe('REVIEW RECOMMENDED');
    expect(report.blockers).toHaveLength(0);
    expect(report.warnings).toHaveLength(1);
    expect(report.warnings[0]?.label).toBe('NEXT_PUBLIC_BASE_PATH is missing from .env.example');
    expect(report.shipScore).toBe(96);
    expect(isShipGateBlocked(report)).toBe(false);
  });

  it('offers a missing silent alarm as optional setup, never as a finding', () => {
    const report = buildShipGateReport(
      [
        {
          ruleId: 'assurly-canary-missing',
          severity: 'warning',
          confidence: 'high',
          file: '.env.example',
          line: 1,
          message:
            'No Assurly silent alarm in .env.example. Plant ASSURLY_CANARY_URL so Assurly can alert if an attacker fetches stolen env.',
          suggestion: 'Add a silent alarm in Assurly (dashboard / MCP plant).',
        },
      ],
      { scannedFileCount: 12, cleanFileCount: 11 },
    );

    expect(report.status).toBe('ready');
    expect(report.blockers).toHaveLength(0);
    expect(report.warnings).toHaveLength(0);
    expect(isShipGateBlocked(report)).toBe(false);
    expect(report.setup?.[0]?.label).toBe('No silent alarm planted');
    expect(report.setup?.[0]?.action?.kind).toBe('link');
    expect(report.setup?.[0]?.action?.href).toBe('#canary-silent-alarm');
    expect(report.setup?.[0]?.action?.label).toBe('Add a silent alarm');
  });

  it('does not let a planted canary change the ship verdict', () => {
    const report = buildShipGateReport(
      [
        {
          ruleId: 'assurly-canary-planted',
          severity: 'warning',
          confidence: 'high',
          file: '.env.example',
          line: 1,
          message:
            'Assurly canary token detected. This is an intentional tripwire, not a leaked credential.',
        },
      ],
      { scannedFileCount: 12, cleanFileCount: 11 },
    );

    expect(report.status).toBe('ready');
    expect(report.warnings).toHaveLength(0);
    expect(isShipGateBlocked(report)).toBe(false);
  });

  it('builds a blocked report with score derived from unique groups', () => {
    const report = buildShipGateReport([...blockers, ...warnings], {
      scannedFileCount: 172,
      cleanFileCount: 168,
    });

    // 2 real blockers × 12 + 2 warning groups × 4 = 24 + 8 = 32 → 68, then blocked cap.
    // The missing CI workflow is optional setup, not a warning.
    expect(report.status).toBe('blocked');
    expect(report.headline).toBe('NOT READY TO SHIP');
    expect(report.blockers).toHaveLength(2);
    expect(report.reviews).toHaveLength(0);
    expect(report.warnings).toHaveLength(2);
    expect(report.setup?.map((group) => group.id)).toEqual(['rule:github-actions-integration']);
    expect(report.shipScore).toBe(BLOCKED_SCORE_CAP);
    expect(report.cleanFileCount).toBe(168);
    expect(isShipGateBlocked(report)).toBe(true);
  });

  it('caps a single-blocker score so blocked never looks shippable', () => {
    const report = buildShipGateReport([blockers[1]!], {
      scannedFileCount: 10,
      cleanFileCount: 9,
    });

    expect(report.status).toBe('blocked');
    expect(report.shipScore).toBeLessThanOrEqual(BLOCKED_SCORE_CAP);
    expect(report.shipScore).toBe(BLOCKED_SCORE_CAP);
  });

  it('caps RLS family penalty so many tables do not zero the score', () => {
    const rlsBlockers = Array.from({ length: 9 }, (_, index) => ({
      ruleId: 'supabase-rls',
      severity: 'error' as const,
      confidence: 'high' as const,
      file: `schema-${index}.sql`,
      message: `Supabase table 'table-${index}' is created but Row-Level Security (RLS) is not enabled.`,
    }));
    const report = buildShipGateReport(rlsBlockers, {
      scannedFileCount: 20,
      cleanFileCount: 11,
    });

    expect(report.status).toBe('blocked');
    expect(report.blockers).toHaveLength(9);
    expect(report.shipScore).toBeLessThanOrEqual(BLOCKED_SCORE_CAP);
    expect(report.shipScore).toBe(BLOCKED_SCORE_CAP);
  });

  it('reports missing RLS on a database no browser can reach as one unscored note', () => {
    const rlsWarnings = Array.from({ length: 5 }, (_, index) => ({
      ruleId: 'supabase-rls',
      severity: 'warning' as const,
      confidence: 'medium' as const,
      file: `schema-${index}.sql`,
      message: `Database table 'table-${index}' is created but Row-Level Security (RLS) is not enabled.`,
    }));
    const report = buildShipGateReport(rlsWarnings);

    expect(report.status).toBe('ready');
    expect(report.warnings).toEqual([]);
    expect(report.shipScore).toBe(100);
    expect(report.advisories).toHaveLength(1);
    expect(report.advisories?.[0]?.label).toBe(
      'No row-level safety net in the database · 5 tables',
    );
    // The stock fix would break the app here; the note must say so.
    expect(report.advisories?.[0]?.sampleMessage).toContain('blocks every query');
    expect(report.advisories?.[0]?.sampleMessage).toContain('table-0, table-1');
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

  it('treats empty findings without an explicit file count as a clean completed scan', () => {
    const report = buildShipGateReport([]);
    expect(report.status).toBe('ready');
    expect(report.headline).toBe('READY TO SHIP');
  });

  it('never claims READY TO SHIP when scannedFileCount is explicitly zero', () => {
    const report = buildShipGateReport([], { scannedFileCount: 0, cleanFileCount: 0 });

    expect(report.scannedFileCount).toBe(0);
    expect(report.status).toBe('review');
    expect(report.headline).toBe('NO FILES SCANNED');
    expect(report.shipScore).toBe(0);
    expect(isShipGateBlocked(report)).toBe(false);
  });

  it('populates scanScope on the report when provided in options', () => {
    const report = buildShipGateReport([], {
      scannedFileCount: 42,
      cleanFileCount: 42,
      scanScope: { scanned: 42, skipped: 18, roots: ['apps/web'] },
    });

    expect(report.scanScope).toEqual({ scanned: 42, skipped: 18, roots: ['apps/web'] });
    expect(formatShipGatePlainText(report)).toContain(
      'Scanned apps/web · 42 source files analysed',
    );
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

  it('turns a clean scan into review when unread backend code is on the security surface', () => {
    const report = buildShipGateReport(
      [
        {
          ruleId: 'scan-language-coverage',
          severity: 'warning',
          confidence: 'high',
          file: 'internal/handler/http/stripe_handler.go',
          message:
            "53 Go files were not analysed — Assurly's rules cover JavaScript, TypeScript and SQL. They include payment and authentication code (internal/handler/http/stripe_handler.go, internal/middleware/auth.go), so this verdict says nothing about that layer.",
        },
      ],
      { scannedFileCount: 71, cleanFileCount: 70 },
    );
    // Unread code is a limit of the scan, not a problem in the app: it keeps
    // the verdict out of Ready without lowering the score of what was read.
    expect(report.status).toBe('review');
    expect(report.headline).toBe('CAN’T CALL IT YET');
    expect(report.partialCoverage).toBe(true);
    expect(report.warnings).toEqual([]);
    expect(report.coverageNotes).toEqual([
      expect.stringContaining('53 Go files were not analysed'),
    ]);
    expect(report.shipScore).toBe(100);
    expect(isShipGateBlocked(report)).toBe(false);
  });

  it('keeps Assurly setup suggestions out of the verdict, including the old ShipReady wording', () => {
    const report = buildShipGateReport(
      [
        {
          ruleId: 'github-actions-integration',
          severity: 'warning',
          file: 'Global Configs',
          message: 'GitHub Actions workflow for Assurly is missing.',
          suggestion:
            'Run "npx assurly init" in your repository to automatically configure the CI/CD pipeline.',
        },
        {
          ruleId: 'general',
          severity: 'warning',
          file: 'Global Configs',
          message: 'GitHub Actions workflow for ShipReady is missing.',
          suggestion:
            'Run "npx shipready init" in your repository to automatically configure the CI/CD pipeline.',
        },
        {
          ruleId: 'assurly-canary-missing',
          severity: 'warning',
          file: '.env.example',
          message: 'No Assurly silent alarm in .env.example.',
        },
      ],
      { scannedFileCount: 15, cleanFileCount: 15 },
    );

    expect(report.status).toBe('ready');
    expect(report.shipScore).toBe(100);
    expect(report.warnings).toEqual([]);
    expect(report.totalWarningFindings).toBe(0);
    expect(report.setup?.map((group) => group.label)).toEqual([
      'Run Assurly on every push',
      'No silent alarm planted',
    ]);
    // `shipready` on npm belongs to someone else: never hand that command out.
    expect(JSON.stringify(report)).not.toMatch(/shipready/i);
    expect(report.setup?.[0]?.action).toMatchObject({
      kind: 'command',
      command: 'npx assurly init',
    });
  });

  it('reports registry lookups that failed as one coverage note, not as findings', () => {
    const registryMisses = Array.from({ length: 19 }, (_, index) => ({
      ruleId: 'dep-registry-unavailable',
      severity: 'warning' as const,
      confidence: 'medium' as const,
      file: 'package.json',
      message: `Could not verify npm registry metadata for 'pkg-${index}' (lookup failed or timed out).`,
    }));
    const report = buildShipGateReport(registryMisses, {
      scannedFileCount: 72,
      cleanFileCount: 72,
    });

    expect(report.status).toBe('ready');
    expect(report.shipScore).toBe(100);
    expect(report.warnings).toEqual([]);
    expect(report.coverageNotes).toEqual([
      'Could not check 19 npm packages against the registry, so they were not checked for lookalike or invented names.',
    ]);
  });

  it('scores the Attesta scan on its real problems only', () => {
    const rls = (table: string) => ({
      ruleId: 'supabase-rls',
      severity: 'warning' as const,
      file: 'db/migrations/003_create_auth_schema.up.sql',
      message: `Database table '${table}' is created but Row-Level Security (RLS) is not enabled.`,
    });
    const report = buildShipGateReport(
      [
        {
          ruleId: 'scan-language-coverage',
          severity: 'warning',
          confidence: 'high',
          file: 'cmd/test_webhook/main.go',
          message: '53 Go files and 1 Python file were not analysed.',
        },
        ...['organizations', 'api_keys', 'user_consents', 'alert_rules', 'alert_history'].map(rls),
        {
          ruleId: 'assurly-canary-planted',
          severity: 'warning',
          file: '.env.example',
          message: 'Assurly canary token detected.',
        },
        {
          ruleId: 'api-route-unvalidated-input',
          severity: 'warning',
          file: 'web/app/api/contact/route.ts',
          message: 'Route handler reads the request body without validating it against a schema.',
        },
        ...Array.from({ length: 19 }, (_, index) => ({
          ruleId: 'dep-registry-unavailable',
          severity: 'warning' as const,
          file: 'package.json',
          message: `Could not verify npm registry metadata for 'pkg-${index}'.`,
        })),
      ],
      { scannedFileCount: 72, cleanFileCount: 68 },
    );

    // Was 76 with 27 findings. Registry timeouts and the unread backend are
    // limits of the scan; missing RLS on a Postgres only the Go API reads is a
    // note. One real problem is left: the contact form's unvalidated input.
    expect(report.shipScore).toBe(96);
    expect(report.status).toBe('review');
    expect(report.headline).toBe('CAN’T CALL IT YET');
    expect(report.warnings.map((group) => group.label)).toEqual(['An API route accepts any input']);
    expect(report.totalWarningFindings).toBe(1);
    expect(report.coverageNotes).toHaveLength(2);
    expect(report.advisories?.[0]?.label).toBe(
      'No row-level safety net in the database · 5 tables',
    );
    expect(report.setup).toEqual([]);
  });

  it('caps incomplete coverage scans as review with score ≤ 79', () => {
    const report = buildShipGateReport(
      [
        {
          ruleId: 'scan-completeness',
          severity: 'warning',
          file: 'Global Configs',
          message: 'Incomplete scan: analyzed 250 of 561 eligible files.',
        },
      ],
      { scannedFileCount: 250, cleanFileCount: 250 },
    );
    expect(report.status).toBe('review');
    expect(report.headline).toBe('INCOMPLETE SCAN — REVIEW');
    expect(report.shipScore).toBeLessThanOrEqual(79);
  });

  it('floors incomplete Instant Gate scores at 40 when there are no blockers', () => {
    const manyWarnings = Array.from({ length: 30 }, (_, index) => ({
      ruleId: `env-missing-${index}`,
      severity: 'warning' as const,
      file: `apps/web/.env.${index}`,
      message: `Undocumented env: VAR_${index}`,
    }));
    const report = buildShipGateReport(
      [
        {
          ruleId: 'scan-completeness',
          severity: 'warning',
          file: 'Global Configs',
          message: 'Incomplete scan: analyzed 250 of 561 eligible files.',
        },
        ...manyWarnings,
      ],
      { scannedFileCount: 250, cleanFileCount: 200 },
    );
    expect(report.status).toBe('review');
    expect(report.headline).toBe('INCOMPLETE SCAN — REVIEW');
    expect(report.shipScore).toBeGreaterThanOrEqual(40);
    expect(report.shipScore).toBeLessThanOrEqual(79);
  });

  it('allows incomplete scans with blockers to score below the no-blocker floor', () => {
    const manyBlockers = Array.from({ length: 8 }, (_, index) => ({
      ruleId: `public-secret-${index}`,
      severity: 'error' as const,
      file: `app/secret-${index}.ts`,
      message: `Hardcoded secret leaked in file secret-${index}.ts.`,
    }));
    const report = buildShipGateReport(
      [
        {
          ruleId: 'scan-completeness',
          severity: 'warning',
          file: 'Global Configs',
          message: 'Incomplete scan: analyzed 250 of 561 eligible files.',
        },
        ...manyBlockers,
      ],
      { scannedFileCount: 250, cleanFileCount: 100 },
    );
    expect(report.status).toBe('blocked');
    expect(report.shipScore).toBeLessThan(40);
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

  it('attaches hint actions to env warnings and RLS blockers', () => {
    const envGroups = buildIssueGroups(envWarnings);
    const blockerGroups = buildIssueGroups(blockers);
    const envGroup = envGroups.find((group) => group.id.startsWith('env:'));
    const rlsGroup = blockerGroups.find((group) => group.id.startsWith('rls:'));

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
    expect(plain).toContain('Ship Score: 59/100');
    expect(plain).toContain('Table users has no row-level security');
    expect(plain).toContain('✓ 168 files clean');
    expect(plain).toContain('Run: npx assurly init');

    expect(markdown).toContain('NOT READY TO SHIP');
    expect(markdown).toContain('Your Stripe webhook does not check signatures');
    expect(markdown).toContain('https://assurly.dev/report/abc123');
    expect(markdown).toContain('`npx assurly init`');
  });

  it('does not count Global Configs or .env.example against Instant Gate clean files', () => {
    const scannedFiles = Array.from({ length: 71 }, (_, index) => `src/file-${index}.ts`);
    const findingFiles = [
      'src/file-0.ts',
      'src/file-1.ts',
      'src/file-2.ts',
      'src/file-3.ts',
      'src/file-4.ts',
      'src/file-5.ts',
      'src/file-6.ts',
      'Global Configs',
      '.env.example',
    ];

    expect(countCleanScannedFiles(71, findingFiles, scannedFiles)).toBe(64);
    expect(countCleanScannedFiles(71, findingFiles)).toBe(64);
    expect(countCleanScannedFiles(71, ['src/a.ts', 'Global Configs', '.env.example'])).toBe(70);
  });
});
