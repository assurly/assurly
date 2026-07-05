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

  it('orders findings stably by file, line, and rule id', () => {
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
    expect(apiIndex).toBeLessThan(sqlIndex);
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

    expect(prompt).toContain('File apps/web/src/lib/stripe.ts, line 12:');
    expect(prompt).toContain('→ Add the missing variable to the nearest .env.example');
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
        message: 'GitHub Actions workflow for ShipReady is missing.',
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
