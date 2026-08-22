import { describe, expect, it } from 'vitest';
import { RLS_GENERIC_TABLE_LABEL, RLS_SUPABASE_TABLE_LABEL } from '@assurly/scanner-core';
import { getCuratedConsequence, getCuratedConsequenceForFinding } from './consequenceMap';

const LIVE_LEAK = 'Anyone on the internet';

describe('getCuratedConsequenceForFinding supabase-rls', () => {
  it('keeps the live-leak copy for a real Supabase stack', () => {
    const entry = getCuratedConsequenceForFinding({
      ruleId: 'supabase-rls',
      message: `${RLS_SUPABASE_TABLE_LABEL} 'organizations' is created but Row-Level Security (RLS) is not enabled.`,
    });

    expect(entry?.consequence).toContain(LIVE_LEAK);
    expect(entry?.regulation).toBe('GDPR / CCPA');
    expect(entry).toEqual(getCuratedConsequence('supabase-rls'));
  });

  it('uses the safety-net copy when the engine found no Supabase stack', () => {
    const entry = getCuratedConsequenceForFinding({
      ruleId: 'supabase-rls',
      message: `${RLS_GENERIC_TABLE_LABEL} 'organizations' is created but Row-Level Security (RLS) is not enabled.`,
    });

    expect(entry?.consequence).not.toContain(LIVE_LEAK);
    expect(entry?.consequence).toMatch(/missing safety net/i);
    expect(entry?.regulation).toBeUndefined();
  });
});
