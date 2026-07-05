import { describe, expect, it } from 'vitest';
import {
  scanAuthLinkedMigrationNoRls,
  scanSupabasePolicies,
  scanSupabaseStorage,
} from './supabasePolicies';

describe('scanSupabasePolicies', () => {
  it('flags USING (true) policies as high-confidence blockers', () => {
    const sql = `
CREATE POLICY "Public read" ON profiles FOR SELECT USING (true);
`;
    const result = scanSupabasePolicies(sql, 'supabase/migrations/policies.sql');
    expect(result.findings[0]).toMatchObject({
      ruleId: 'supabase-policy-permissive',
      severity: 'error',
      confidence: 'high',
    });
  });

  it('does not flag scoped auth.uid() policies', () => {
    const sql = `
CREATE POLICY "Own rows" ON profiles FOR SELECT USING (auth.uid() = user_id);
`;
    expect(scanSupabasePolicies(sql, 'supabase/migrations/policies.sql').findings).toEqual([]);
  });
});

describe('scanSupabaseStorage', () => {
  it('warns when a storage bucket is created public', () => {
    const sql = `INSERT INTO storage.buckets (id, name, public) VALUES ('avatars', 'avatars', true);`;
    const result = scanSupabaseStorage(sql, 'supabase/migrations/storage.sql');
    expect(result.findings[0]).toMatchObject({
      ruleId: 'supabase-storage-public-default',
      severity: 'warning',
      confidence: 'high',
    });
  });

  it('does not warn on private bucket inserts', () => {
    const sql = `INSERT INTO storage.buckets (id, name, public) VALUES ('avatars', 'avatars', false);`;
    expect(scanSupabaseStorage(sql, 'supabase/migrations/storage.sql').findings).toEqual([]);
  });
});

describe('scanAuthLinkedMigrationNoRls', () => {
  it('flags auth.users-linked tables without RLS', () => {
    const result = scanAuthLinkedMigrationNoRls([
      {
        file: 'supabase/migrations/001.sql',
        content:
          'CREATE TABLE profiles (id uuid primary key, user_id uuid references auth.users(id));',
      },
    ]);
    expect(result.findings[0]).toMatchObject({
      ruleId: 'supabase-migration-auth-linked-no-rls',
      severity: 'error',
      confidence: 'high',
    });
  });

  it('passes when RLS is enabled for auth-linked tables', () => {
    const result = scanAuthLinkedMigrationNoRls([
      {
        file: 'supabase/migrations/001.sql',
        content: [
          'CREATE TABLE profiles (id uuid primary key, user_id uuid references auth.users(id));',
          'ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;',
        ].join('\n'),
      },
    ]);
    expect(result.findings).toEqual([]);
  });
});
