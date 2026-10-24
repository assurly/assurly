import { describe, expect, it } from 'vitest';
import { canonicalizeLegacyFinding } from './legacyRuleIds';

describe('canonicalizeLegacyFinding', () => {
  it("gives an older CLI's missing-RLS finding the id and words the dashboard uses", () => {
    expect(
      canonicalizeLegacyFinding({
        ruleId: 'supabase-security-checks',
        severity: 'error',
        file: 'supabase/migrations/0001.sql',
        line: 1,
        message:
          "Supabase table 'customers' is created in migration files, but Row-Level Security (RLS) is not enabled.",
      }),
    ).toEqual({
      ruleId: 'supabase-rls',
      severity: 'error',
      file: 'supabase/migrations/0001.sql',
      line: 1,
      message: "Supabase table 'customers' is created but Row-Level Security (RLS) is not enabled.",
    });
  });

  it('restores the service-role leak and public-secret ids the wrapper hid', () => {
    expect(
      canonicalizeLegacyFinding({
        ruleId: 'supabase-security-checks',
        message: 'Potential service_role key leakage in a Client Component.',
      }).ruleId,
    ).toBe('supabase-service-role-leak');
    expect(
      canonicalizeLegacyFinding({
        ruleId: 'supabase-security-checks',
        message: "'SUPABASE_SERVICE_ROLE_KEY' exposes a server secret to the browser.",
      }).ruleId,
    ).toBe('public-secret');
  });

  it('leaves current findings, and legacy ones it cannot place, untouched', () => {
    const current = { ruleId: 'supabase-rls', message: 'anything' };
    expect(canonicalizeLegacyFinding(current)).toBe(current);
    const unknown = { ruleId: 'supabase-security-checks', message: 'Something else.' };
    expect(canonicalizeLegacyFinding(unknown)).toBe(unknown);
  });
});
