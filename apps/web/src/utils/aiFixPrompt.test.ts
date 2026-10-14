import { describe, expect, it } from 'vitest';
import { buildAiFixPrompt } from './aiFixPrompt';
import type { WebFinding } from './browserScanner';

function finding(
  partial: Partial<WebFinding> & Pick<WebFinding, 'ruleId' | 'message'>,
): WebFinding {
  return {
    severity: 'error',
    ...partial,
  };
}

describe('buildAiFixPrompt', () => {
  it('returns a deterministic no-issues prompt for empty input', () => {
    expect(buildAiFixPrompt([])).toContain('No issues to fix.');
  });

  it('puts what blocks launch first, whatever the file order', () => {
    const findings: WebFinding[] = [
      finding({
        ruleId: 'supabase-rls',
        file: 'db/schema.sql',
        line: 2,
        message: "Supabase table 'users' is created but Row-Level Security (RLS) is not enabled.",
        suggestion: 'Enable RLS on users.',
      }),
      finding({
        ruleId: 'undocumented-env',
        file: 'apps/web/src/api.ts',
        line: 1,
        message:
          "Environment variable 'process.env.STRIPE_SECRET_KEY' is used but not documented in '.env.example'.",
        suggestion: 'Add STRIPE_SECRET_KEY= to .env.example.',
      }),
    ];

    const prompt = buildAiFixPrompt(findings);
    const apiIndex = prompt.indexOf('apps/web/src/api.ts');
    const sqlIndex = prompt.indexOf('db/schema.sql');
    expect(apiIndex).toBeGreaterThan(-1);
    expect(sqlIndex).toBeGreaterThan(-1);
    // The open table blocks launch; the undocumented variable does not.
    expect(sqlIndex).toBeLessThan(apiIndex);
    expect(prompt).toContain('1. Table users has no row-level security [blocks launch]');
  });

  it('masks secret-like values in the prompt output', () => {
    const prompt = buildAiFixPrompt([
      finding({
        ruleId: 'ai-llm-key-in-client',
        file: 'client.tsx',
        line: 4,
        message: 'Hard-coded LLM secret key pattern sk-ant-api03-abcdef123456 found.',
        suggestion: 'Rotate the key sk-ant-api03-abcdef123456 immediately.',
      }),
    ]);

    expect(prompt).toContain('[REDACTED_SECRET]');
    expect(prompt).not.toContain('sk-ant-api03-abcdef123456');
  });

  it('includes file, line, and a concrete instruction per finding', () => {
    const prompt = buildAiFixPrompt([
      finding({
        ruleId: 'undocumented-env',
        file: 'apps/web/src/lib/stripe.ts',
        line: 12,
        message:
          "Environment variable 'process.env.STRIPE_SECRET_KEY' is used but not documented in '.env.example'.",
      }),
    ]);

    expect(prompt).toContain('Where: apps/web/src/lib/stripe.ts:12');
    expect(prompt).toContain('Fix: Add the missing variable to the nearest .env.example');
  });

  it('gives the agent the context, the limits and the check that proves the work is done', () => {
    const prompt = buildAiFixPrompt(
      [
        finding({
          ruleId: 'api-route-unvalidated-input',
          severity: 'warning',
          file: 'web/app/api/contact/route.ts',
          line: 17,
          message: 'Route handler reads the request body without validating it against a schema.',
          suggestion: 'Parse the body with a schema and reject invalid input before using it.',
        }),
        finding({
          ruleId: 'dep-registry-unavailable',
          severity: 'warning',
          file: 'package.json',
          message: "Could not verify npm registry metadata for 'next'.",
        }),
        finding({
          ruleId: 'github-actions-integration',
          severity: 'warning',
          file: 'Global Configs',
          message: 'GitHub Actions workflow for Assurly is missing.',
        }),
      ],
      {
        repository: 'tibco87/Attesta',
        commit: '06b0c6d9ce0a39d355d38067e1bb067e7ce0c53d',
        notChecked: ['53 Go files were not analysed.'],
      },
    );

    expect(prompt).toMatch(/^Fix this problem in tibco87\/Attesta before launch/);
    expect(prompt).toContain('Found by Assurly in commit 06b0c6d.');
    expect(prompt).toContain('1. An API route accepts any input [fix before launch]');
    // Our own lookups and setup suggestions are not work for the agent.
    expect(prompt).not.toMatch(/registry|GitHub Actions/);
    expect(prompt).toContain('Not part of this task');
    expect(prompt).toContain('- 53 Go files were not analysed.');
    expect(prompt.trimEnd()).toMatch(
      /npx assurly scan\nExpected: none of the problems above is reported\.$/,
    );
  });
});

describe('buildAiFixPrompt determinism', () => {
  it('returns identical text for the same finding set', () => {
    const findings: WebFinding[] = [
      finding({
        ruleId: 'github-actions-integration',
        severity: 'warning',
        file: 'Global Configs',
        line: 1,
        message: 'GitHub Actions workflow for Assurly is missing.',
      }),
      finding({
        ruleId: 'supabase-rls',
        file: 'schema.sql',
        line: 1,
        message:
          "Supabase table 'accounts' is created but Row-Level Security (RLS) is not enabled.",
        suggestion: 'Enable RLS on accounts.',
      }),
    ];

    expect(buildAiFixPrompt(findings)).toBe(buildAiFixPrompt([...findings].reverse()));
  });
});
