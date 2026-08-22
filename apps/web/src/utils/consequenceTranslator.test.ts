import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CONSEQUENCE_MAP, getConsequence, getCuratedConsequence } from './consequenceTranslator';
import { clearAiCache, resetAiBudget } from './ai/claudeClient';

function aiResponse(text: string, status = 200): Response {
  return new Response(JSON.stringify({ content: [{ type: 'text', text }] }), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('getCuratedConsequence', () => {
  it('returns a curated entry for a known rule', () => {
    const entry = getCuratedConsequence('runtime-supabase-rls-open');
    expect(entry?.consequence).toMatch(/database/i);
    expect(entry?.regulation).toBe('GDPR / CCPA');
  });

  it('returns undefined for an unknown rule', () => {
    expect(getCuratedConsequence('totally-unknown-rule')).toBeUndefined();
  });

  it('covers every rule id the scanners emit', () => {
    // Guards against a scanner adding a rule without a curated consequence.
    const knownRuleIds = [
      'ai-llm-key-in-client',
      'ai-missing-rate-limit',
      'ai-pii-to-model-context',
      'ai-prompt-injection-surface',
      'ai-route-missing-authz',
      'auth-route-handler-unprotected',
      'auth-server-action-no-check',
      'auth-service-role-bypass',
      'cold-start-optimization',
      'database-migration-safety',
      'general',
      'github-actions-integration',
      'public-secret',
      'rsc-data-leaks',
      'runtime-missing-security-headers',
      'runtime-secret-in-bundle',
      'runtime-supabase-anon-write-implied',
      'runtime-supabase-rls-open',
      'scan-completeness',
      'scan-language-coverage',
      'stripe-live-key-in-dev',
      'stripe-missing-subscription-events',
      'stripe-secret-leak',
      'stripe-webhook-no-idempotency',
      'stripe-webhook-signature',
      'supabase-migration-auth-linked-no-rls',
      'supabase-policy-permissive',
      'supabase-rls',
      'supabase-service-role-leak',
      'supabase-storage-public-default',
      'undocumented-env',
      'vercel-edge-node-mismatch',
      'vercel-maxduration-missing',
    ];
    for (const ruleId of knownRuleIds) {
      expect(CONSEQUENCE_MAP[ruleId], `missing consequence for ${ruleId}`).toBeDefined();
    }
  });
});

describe('getConsequence', () => {
  beforeEach(() => {
    clearAiCache();
    resetAiBudget();
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
  });

  afterEach(() => {
    delete process.env.ANTHROPIC_API_KEY;
  });

  it('returns the curated consequence without calling AI', async () => {
    const fetchImpl = vi.fn();
    const result = await getConsequence(
      { ruleId: 'supabase-rls', message: 'raw message' },
      { deps: { fetchImpl } },
    );
    expect(result.source).toBe('curated');
    expect(result.text).toMatch(/missing safety net/i);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('falls back to an AI sentence for an unknown rule', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(aiResponse('Attackers can drain your wallet.'));
    const result = await getConsequence(
      { ruleId: 'novel-rule', message: 'raw technical message' },
      { deps: { fetchImpl } },
    );
    expect(result.source).toBe('ai');
    expect(result.text).toBe('Attackers can drain your wallet.');
  });

  it('falls back to the raw message when AI fails', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(aiResponse('', 500));
    const result = await getConsequence(
      { ruleId: 'novel-rule', message: 'raw technical message' },
      { deps: { fetchImpl } },
    );
    expect(result.source).toBe('message');
    expect(result.text).toBe('raw technical message');
  });

  it('falls back to the message when AI is disabled', async () => {
    const fetchImpl = vi.fn();
    const result = await getConsequence(
      { ruleId: 'novel-rule', message: 'raw technical message' },
      { useAi: false, deps: { fetchImpl } },
    );
    expect(result.source).toBe('message');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('falls back to the message when the AI key is unset', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const fetchImpl = vi.fn();
    const result = await getConsequence(
      { ruleId: 'novel-rule', message: 'raw technical message' },
      { deps: { fetchImpl } },
    );
    expect(result.source).toBe('message');
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
