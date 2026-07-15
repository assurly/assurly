import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearAiCache } from './claudeClient';
import { getContextualFixExplanation } from './contextualFix';

describe('getContextualFixExplanation', () => {
  afterEach(() => {
    clearAiCache();
    vi.unstubAllEnvs();
  });

  it('uses curated consequence when available (no AI call)', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'test-key');
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const result = await getContextualFixExplanation(
      {
        ruleId: 'runtime-supabase-rls-open',
        severity: 'error',
        message: 'Table users is open',
        suggestion: 'Enable RLS',
      },
      { deps: { fetchImpl } },
    );
    expect(result.whySource).toBe('curated');
    expect(result.whyItMatters.length).toBeGreaterThan(10);
    expect(result.fixPrompt).toContain('Assurly fix prompt');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('degrades to message when AI is unavailable and no curated entry', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', '');
    const result = await getContextualFixExplanation({
      ruleId: 'totally-unknown-rule-xyz',
      severity: 'warning',
      message: 'Something odd',
    });
    expect(result.whySource).toBe('message');
    expect(result.whyItMatters).toBe('Something odd');
  });
});
