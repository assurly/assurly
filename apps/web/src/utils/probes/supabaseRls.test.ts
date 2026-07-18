import { describe, expect, it } from 'vitest';
import { buildAnonWriteImpliedFindings, supabaseTableLocation } from './supabaseRls';

describe('supabaseTableLocation', () => {
  it('scopes the finding location to the table so regression keys stay distinct', () => {
    expect(supabaseTableLocation('customers')).toBe('Supabase REST API · customers');
    expect(supabaseTableLocation('invoices')).not.toBe(supabaseTableLocation('customers'));
  });

  it('is stable for a given table (no volatile data that would cause false regressions)', () => {
    expect(supabaseTableLocation('orders')).toBe(supabaseTableLocation('orders'));
  });
});

describe('buildAnonWriteImpliedFindings', () => {
  it('carries the table name in file so each table is an independent finding', () => {
    const findings = buildAnonWriteImpliedFindings(['customers', 'invoices']);
    expect(findings).toHaveLength(2);
    expect(findings.map((f) => f.file)).toEqual([
      supabaseTableLocation('customers'),
      supabaseTableLocation('invoices'),
    ]);
    // Same rule + no line: file is the only thing keeping the two findings distinct.
    expect(new Set(findings.map((f) => f.file)).size).toBe(2);
    expect(findings.every((f) => f.ruleId === 'runtime-supabase-anon-write-implied')).toBe(true);
  });

  it('returns nothing when no tables are open', () => {
    expect(buildAnonWriteImpliedFindings([])).toEqual([]);
  });
});
