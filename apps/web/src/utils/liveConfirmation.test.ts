import { describe, expect, it } from 'vitest';
import { RLS_GENERIC_TABLE_LABEL, RLS_SUPABASE_TABLE_LABEL } from '@assurly/scanner-core';
import {
  confirmFindingsLive,
  routeFileToApiPath,
  staticFindingSubject,
  type LiveConfirmableFinding,
  type LiveProofEvidence,
} from './liveConfirmation';

function finding(
  overrides: Partial<LiveConfirmableFinding> & Pick<LiveConfirmableFinding, 'rule_id' | 'message'>,
): LiveConfirmableFinding {
  return {
    severity: 'error',
    confidence: 'medium',
    file_path: 'supabase/schema.sql',
    ...overrides,
  };
}

function rlsRows(
  table: string,
  summary = `We read 1,204 rows from your \`${table}\` table.`,
): LiveProofEvidence {
  return {
    kind: 'rls_rows',
    summary,
    redactedSample: { table },
  };
}

function openEndpoint(
  path: string,
  summary = `GET ${path} answered with 3 record(s) without a session.`,
): LiveProofEvidence {
  return {
    kind: 'open_endpoint',
    summary,
    redactedSample: { path },
  };
}

describe('routeFileToApiPath', () => {
  it('maps App Router files, dropping a monorepo prefix', () => {
    expect(routeFileToApiPath('web/app/api/contact/route.ts')).toBe('/api/contact');
  });

  it('drops route groups', () => {
    expect(routeFileToApiPath('src/app/api/(v1)/orders/route.ts')).toBe('/api/orders');
  });

  it('maps pages/api index files to the parent path', () => {
    expect(routeFileToApiPath('pages/api/users/index.ts')).toBe('/api/users');
  });

  it('returns null for dynamic segments', () => {
    expect(routeFileToApiPath('app/api/users/[id]/route.ts')).toBeNull();
  });

  it('returns null when the file is not a route handler', () => {
    expect(routeFileToApiPath('app/lib/api/x.ts')).toBeNull();
  });
});

describe('staticFindingSubject', () => {
  it('parses supabase-rls from both exported table labels', () => {
    expect(
      staticFindingSubject(
        finding({
          rule_id: 'supabase-rls',
          message: `${RLS_SUPABASE_TABLE_LABEL} 'customers' is created but Row-Level Security (RLS) is not enabled.`,
        }),
      ),
    ).toEqual({ kind: 'table', table: 'customers' });
    expect(
      staticFindingSubject(
        finding({
          rule_id: 'supabase-rls',
          message: `${RLS_GENERIC_TABLE_LABEL} 'orders' is created but Row-Level Security (RLS) is not enabled.`,
        }),
      ),
    ).toEqual({ kind: 'table', table: 'orders' });
  });

  it('parses supabase-migration-auth-linked-no-rls', () => {
    expect(
      staticFindingSubject(
        finding({
          rule_id: 'supabase-migration-auth-linked-no-rls',
          message:
            "Table 'profiles' references auth.users but Row-Level Security (RLS) is not enabled.",
        }),
      ),
    ).toEqual({ kind: 'table', table: 'profiles' });
  });

  it('parses supabase-policy-permissive', () => {
    expect(
      staticFindingSubject(
        finding({
          rule_id: 'supabase-policy-permissive',
          message:
            "RLS policy on 'invoices' uses USING (true) and is effectively open to everyone.",
        }),
      ),
    ).toEqual({ kind: 'table', table: 'invoices' });
  });

  it('maps auth-route-handler-unprotected from the route file path', () => {
    expect(
      staticFindingSubject(
        finding({
          rule_id: 'auth-route-handler-unprotected',
          file_path: 'web/app/api/contact/route.ts',
          message: 'Route handler under a protected path has no session or authorization check.',
        }),
      ),
    ).toEqual({ kind: 'route', path: '/api/contact' });
  });

  it('returns null for api-route-unvalidated-input', () => {
    expect(
      staticFindingSubject(
        finding({
          rule_id: 'api-route-unvalidated-input',
          file_path: 'src/app/api/orders/route.ts',
          message: 'Route handler reads the request body without validating it against a schema.',
        }),
      ),
    ).toBeNull();
  });
});

describe('confirmFindingsLive', () => {
  const origin = 'https://app.example.com';

  it('confirms a matching table finding: high confidence, suffix, input untouched', () => {
    const input = finding({
      rule_id: 'supabase-rls',
      message: `${RLS_SUPABASE_TABLE_LABEL} 'customers' is created but Row-Level Security (RLS) is not enabled.`,
    });
    const evidence = [rlsRows('customers')];
    const result = confirmFindingsLive([input], evidence, origin);

    expect(result.confirmed).toBe(1);
    expect(result.findings[0]?.confidence).toBe('high');
    expect(result.findings[0]?.severity).toBe('error');
    expect(result.findings[0]?.message).toBe(
      `${input.message} Confirmed live on ${origin}: ${evidence[0]?.summary}`,
    );
    expect(input.confidence).toBe('medium');
    expect(input.message.endsWith(evidence[0]!.summary)).toBe(false);
  });

  it('confirms a matching unprotected route finding', () => {
    const input = finding({
      rule_id: 'auth-route-handler-unprotected',
      file_path: 'src/app/api/orders/route.ts',
      message: 'Route handler under a protected path has no session or authorization check.',
    });
    const evidence = [openEndpoint('/api/orders')];
    const result = confirmFindingsLive([input], evidence, origin);

    expect(result.confirmed).toBe(1);
    expect(result.findings[0]?.confidence).toBe('high');
    expect(result.findings[0]?.message).toContain(
      `Confirmed live on ${origin}: ${evidence[0]?.summary}`,
    );
  });

  it('leaves a finding unchanged when the table does not match', () => {
    const input = finding({
      rule_id: 'supabase-rls',
      message: `${RLS_SUPABASE_TABLE_LABEL} 'customers' is created but Row-Level Security (RLS) is not enabled.`,
    });
    const result = confirmFindingsLive([input], [rlsRows('orders')], origin);
    expect(result.confirmed).toBe(0);
    expect(result.findings[0]?.confidence).toBe('medium');
    expect(result.findings[0]?.message).toBe(input.message);
  });

  it('does not confirm auth-route-handler-mutates-unguarded even with a matching path', () => {
    const input = finding({
      rule_id: 'auth-route-handler-mutates-unguarded',
      file_path: 'src/app/api/orders/route.ts',
      message: 'Route handler mutates state without an authorization check.',
    });
    const result = confirmFindingsLive([input], [openEndpoint('/api/orders')], origin);
    expect(result.confirmed).toBe(0);
    expect(result.findings[0]?.confidence).toBe('medium');
    expect(result.findings[0]?.message).toBe(input.message);
  });

  it('skips an api path mapped from more than one distinct route file', () => {
    const a = finding({
      rule_id: 'auth-route-handler-unprotected',
      file_path: 'web/app/api/users/route.ts',
      message: 'Route handler under a protected path has no session or authorization check.',
    });
    const b = finding({
      rule_id: 'auth-route-handler-unprotected',
      file_path: 'app/api/users/route.ts',
      message: 'Route handler under a protected path has no session or authorization check.',
    });
    const result = confirmFindingsLive([a, b], [openEndpoint('/api/users')], origin);
    expect(result.confirmed).toBe(0);
    expect(result.findings[0]?.message).toBe(a.message);
    expect(result.findings[1]?.message).toBe(b.message);
  });

  it('never appends the live suffix twice', () => {
    const input = finding({
      rule_id: 'supabase-rls',
      message: `${RLS_SUPABASE_TABLE_LABEL} 'customers' is created but Row-Level Security (RLS) is not enabled.`,
    });
    const evidence = [rlsRows('customers')];
    const first = confirmFindingsLive([input], evidence, origin);
    const second = confirmFindingsLive(first.findings, evidence, origin);
    expect(second.confirmed).toBe(0);
    expect(second.findings[0]?.message).toBe(first.findings[0]?.message);
    expect((second.findings[0]?.message.match(/Confirmed live on /g) ?? []).length).toBe(1);
  });

  it('counts every newly confirmed finding', () => {
    const table = finding({
      rule_id: 'supabase-policy-permissive',
      message: "RLS policy on 'invoices' uses USING (true) and is effectively open to everyone.",
    });
    const authLinked = finding({
      rule_id: 'supabase-migration-auth-linked-no-rls',
      message:
        "Table 'profiles' references auth.users but Row-Level Security (RLS) is not enabled.",
    });
    const result = confirmFindingsLive(
      [table, authLinked],
      [rlsRows('invoices', 'open invoices'), rlsRows('profiles', 'open profiles')],
      origin,
    );
    expect(result.confirmed).toBe(2);
  });
});
