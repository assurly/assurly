import { describe, expect, it } from 'vitest';
import type { ScannerFinding } from '@assurly/scanner-core';
import {
  classifyReprobeOutcomes,
  collectProbeRuleIds,
  deriveBeforeSet,
  latestOutcomeByRule,
  resolveFixOutcome,
  rollupFixOutcomes,
  type CorpusPatternRow,
  type FixOutcomeHistoryRow,
} from './verifiedFix';

function finding(ruleId: string, severity: 'error' | 'warning' = 'error'): ScannerFinding {
  return { ruleId, severity, message: `${ruleId} message` };
}

describe('collectProbeRuleIds', () => {
  it('collects only error-severity rule ids', () => {
    const ids = collectProbeRuleIds([
      finding('runtime-supabase-rls-open'),
      finding('runtime-missing-header', 'warning'),
      finding('runtime-secret-in-bundle'),
    ]);
    expect([...ids].sort()).toEqual(['runtime-secret-in-bundle', 'runtime-supabase-rls-open']);
  });

  it('returns an empty set for no findings', () => {
    expect(collectProbeRuleIds([]).size).toBe(0);
  });
});

describe('resolveFixOutcome', () => {
  it('returns verified_fixed when present before and gone after', () => {
    expect(resolveFixOutcome(['rls'], [], 'rls')).toBe('verified_fixed');
  });

  it('returns still_open when present in both probes', () => {
    expect(resolveFixOutcome(['rls'], ['rls'], 'rls')).toBe('still_open');
  });

  it('returns regressed when absent before and present after', () => {
    expect(resolveFixOutcome([], ['rls'], 'rls')).toBe('regressed');
  });

  it('accepts Set inputs as well as arrays', () => {
    expect(resolveFixOutcome(new Set(['rls']), new Set<string>(), 'rls')).toBe('verified_fixed');
  });

  it('throws for a rule that appears in neither set (untracked)', () => {
    expect(() => resolveFixOutcome(['a'], ['b'], 'c')).toThrow(/untracked/);
  });
});

describe('latestOutcomeByRule', () => {
  it('keeps only the latest outcome per rule id by created_at', () => {
    const rows: FixOutcomeHistoryRow[] = [
      { finding_rule_id: 'rls', outcome: 'still_open', created_at: '2026-07-16T10:00:00Z' },
      { finding_rule_id: 'rls', outcome: 'verified_fixed', created_at: '2026-07-16T12:00:00Z' },
      { finding_rule_id: 'secret', outcome: 'still_open', created_at: '2026-07-16T09:00:00Z' },
    ];
    const latest = latestOutcomeByRule(rows);
    expect(latest.get('rls')).toBe('verified_fixed');
    expect(latest.get('secret')).toBe('still_open');
  });

  it('is empty for no history', () => {
    expect(latestOutcomeByRule([]).size).toBe(0);
  });
});

describe('deriveBeforeSet', () => {
  it('treats still_open and regressed as open, verified_fixed as closed', () => {
    const before = deriveBeforeSet(
      new Map([
        ['rls', 'still_open'],
        ['secret', 'verified_fixed'],
        ['idor', 'regressed'],
      ]),
    );
    expect([...before].sort()).toEqual(['idor', 'rls']);
  });
});

describe('classifyReprobeOutcomes', () => {
  it('marks a previously-open rule that is gone as verified_fixed', () => {
    const result = classifyReprobeOutcomes({
      before: new Set(['rls']),
      after: new Set<string>(),
      known: new Set(['rls']),
    });
    expect(result).toEqual([{ ruleId: 'rls', outcome: 'verified_fixed' }]);
  });

  it('marks a still-present rule as still_open', () => {
    const result = classifyReprobeOutcomes({
      before: new Set(['rls']),
      after: new Set(['rls']),
      known: new Set(['rls']),
    });
    expect(result).toEqual([{ ruleId: 'rls', outcome: 'still_open' }]);
  });

  it('marks a reappearing, previously-closed rule as regressed', () => {
    const result = classifyReprobeOutcomes({
      before: new Set<string>(),
      after: new Set(['rls']),
      known: new Set(['rls']),
    });
    expect(result).toEqual([{ ruleId: 'rls', outcome: 'regressed' }]);
  });

  it('marks a first-seen open rule as still_open (baseline, not regressed)', () => {
    const result = classifyReprobeOutcomes({
      before: new Set<string>(),
      after: new Set(['rls']),
      known: new Set<string>(),
    });
    expect(result).toEqual([{ ruleId: 'rls', outcome: 'still_open' }]);
  });

  it('classifies a mixed re-probe across all branches', () => {
    const result = classifyReprobeOutcomes({
      before: new Set(['rls', 'still']),
      after: new Set(['still', 'regressed-rule', 'brand-new']),
      known: new Set(['rls', 'still', 'regressed-rule']),
    });
    const byRule = new Map(result.map((r) => [r.ruleId, r.outcome]));
    expect(byRule.get('rls')).toBe('verified_fixed');
    expect(byRule.get('still')).toBe('still_open');
    expect(byRule.get('regressed-rule')).toBe('regressed');
    expect(byRule.get('brand-new')).toBe('still_open');
  });

  it('returns nothing when both sets are empty', () => {
    expect(
      classifyReprobeOutcomes({ before: new Set(), after: new Set(), known: new Set() }),
    ).toEqual([]);
  });
});

describe('rollupFixOutcomes', () => {
  it('aggregates counts and a verified-fixed rate per (generator, rule, strategy)', () => {
    const rows: CorpusPatternRow[] = [
      {
        generator_fingerprint: 'lovable',
        finding_rule_id: 'runtime-supabase-rls-open',
        fix_strategy: 'enable-rls',
        outcome: 'verified_fixed',
      },
      {
        generator_fingerprint: 'lovable',
        finding_rule_id: 'runtime-supabase-rls-open',
        fix_strategy: 'enable-rls',
        outcome: 'verified_fixed',
      },
      {
        generator_fingerprint: 'lovable',
        finding_rule_id: 'runtime-supabase-rls-open',
        fix_strategy: 'enable-rls',
        outcome: 'still_open',
      },
      {
        generator_fingerprint: 'lovable',
        finding_rule_id: 'runtime-supabase-rls-open',
        fix_strategy: 'enable-rls',
        outcome: 'regressed',
      },
    ];
    const [pattern] = rollupFixOutcomes(rows);
    expect(pattern).toMatchObject({
      generatorFingerprint: 'lovable',
      findingRuleId: 'runtime-supabase-rls-open',
      fixStrategy: 'enable-rls',
      total: 4,
      verifiedFixed: 2,
      stillOpen: 1,
      regressed: 1,
    });
    expect(pattern.verifiedFixedRate).toBeCloseTo(0.5);
  });

  it('coerces null generator/strategy to "unknown" and never leaks a row', () => {
    const patterns = rollupFixOutcomes([
      {
        generator_fingerprint: null,
        finding_rule_id: 'r',
        fix_strategy: null,
        outcome: 'still_open',
      },
    ]);
    expect(patterns).toHaveLength(1);
    expect(patterns[0].generatorFingerprint).toBe('unknown');
    expect(patterns[0].fixStrategy).toBe('unknown');
    expect(Object.keys(patterns[0])).not.toContain('organization_id');
  });

  it('sorts the most common patterns first', () => {
    const patterns = rollupFixOutcomes([
      {
        generator_fingerprint: 'v0',
        finding_rule_id: 'a',
        fix_strategy: 's',
        outcome: 'still_open',
      },
      {
        generator_fingerprint: 'bolt',
        finding_rule_id: 'b',
        fix_strategy: 's',
        outcome: 'still_open',
      },
      {
        generator_fingerprint: 'bolt',
        finding_rule_id: 'b',
        fix_strategy: 's',
        outcome: 'still_open',
      },
    ]);
    expect(patterns[0].generatorFingerprint).toBe('bolt');
    expect(patterns[0].total).toBe(2);
  });
});
