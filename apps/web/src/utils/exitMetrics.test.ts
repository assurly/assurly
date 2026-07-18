import { describe, expect, it } from 'vitest';
import type { FixOutcomeCorpusRow } from './dbAdapter';
import { rollupExitMetrics } from './exitMetrics';

function row(overrides: Partial<FixOutcomeCorpusRow>): FixOutcomeCorpusRow {
  return {
    generator_fingerprint: 'lovable',
    finding_rule_id: 'runtime-supabase-rls-open',
    fix_strategy: null,
    outcome: 'verified_fixed',
    ...overrides,
  };
}

describe('rollupExitMetrics', () => {
  it('returns zeroed metrics for an empty corpus', () => {
    const metrics = rollupExitMetrics([], 0);
    expect(metrics).toEqual({
      appsMonitored: 0,
      corpusSize: 0,
      outcomes: { verifiedFixed: 0, stillOpen: 0, regressed: 0, total: 0 },
      verifiedFixRate: null,
      regressionsCaught: 0,
      fixesVerified: 0,
      byGenerator: [],
      byRule: [],
    });
  });

  it('tallies overall outcomes and the verified-fix rate (excludes still_open)', () => {
    const metrics = rollupExitMetrics(
      [
        row({ outcome: 'verified_fixed' }),
        row({ outcome: 'verified_fixed' }),
        row({ outcome: 'verified_fixed' }),
        row({ outcome: 'regressed' }),
        row({ outcome: 'still_open' }),
      ],
      12,
    );
    expect(metrics.appsMonitored).toBe(12);
    expect(metrics.corpusSize).toBe(5);
    expect(metrics.outcomes).toEqual({
      verifiedFixed: 3,
      stillOpen: 1,
      regressed: 1,
      total: 5,
    });
    // 3 fixed / (3 fixed + 1 regressed) = 0.75; still_open is not a resolution.
    expect(metrics.verifiedFixRate).toBe(0.75);
    expect(metrics.fixesVerified).toBe(3);
    expect(metrics.regressionsCaught).toBe(1);
  });

  it('groups by generator fingerprint (null → "unknown"), most rows first', () => {
    const metrics = rollupExitMetrics(
      [
        row({ generator_fingerprint: 'lovable', outcome: 'verified_fixed' }),
        row({ generator_fingerprint: 'lovable', outcome: 'still_open' }),
        row({ generator_fingerprint: 'v0', outcome: 'regressed' }),
        row({ generator_fingerprint: null, outcome: 'verified_fixed' }),
      ],
      3,
    );
    expect(metrics.byGenerator[0]).toEqual({
      key: 'lovable',
      outcomes: { verifiedFixed: 1, stillOpen: 1, regressed: 0, total: 2 },
    });
    const keys = metrics.byGenerator.map((s) => s.key);
    expect(keys).toContain('unknown');
    expect(keys).toContain('v0');
  });

  it('groups by rule id', () => {
    const metrics = rollupExitMetrics(
      [
        row({ finding_rule_id: 'runtime-supabase-rls-open', outcome: 'verified_fixed' }),
        row({ finding_rule_id: 'runtime-supabase-rls-open', outcome: 'regressed' }),
        row({ finding_rule_id: 'runtime-missing-security-headers', outcome: 'still_open' }),
      ],
      1,
    );
    const rls = metrics.byRule.find((s) => s.key === 'runtime-supabase-rls-open');
    expect(rls?.outcomes).toEqual({ verifiedFixed: 1, stillOpen: 0, regressed: 1, total: 2 });
  });

  it('exposes AGGREGATE fields only — no customer data can appear (anti-leak)', () => {
    // Even if a corpus row carried a fix strategy, it must never surface: the
    // rollup counts patterns and returns nothing customer-identifying.
    const metrics = rollupExitMetrics(
      [
        row({
          generator_fingerprint: 'bolt',
          fix_strategy: 'enable-rls',
          outcome: 'verified_fixed',
        }),
        row({ generator_fingerprint: 'bolt', fix_strategy: 'rotate-key', outcome: 'regressed' }),
      ],
      7,
    );

    const allowedTopKeys = [
      'appsMonitored',
      'corpusSize',
      'outcomes',
      'verifiedFixRate',
      'regressionsCaught',
      'fixesVerified',
      'byGenerator',
      'byRule',
    ].sort();
    expect(Object.keys(metrics).sort()).toEqual(allowedTopKeys);

    const serialized = JSON.stringify(metrics);
    // No fix strategy, message, table name, org/target id, PII, pr/deploy fields.
    for (const forbidden of [
      'enable-rls',
      'rotate-key',
      'fix_strategy',
      'fixStrategy',
      'message',
      'organization',
      'organization_id',
      'target_id',
      'pr_url',
      'deploy_id',
      '@',
      'customers',
      'users',
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });
});
