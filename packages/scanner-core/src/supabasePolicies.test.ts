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

  it("never pins the next statement's auth.users reference on an earlier table", () => {
    // `notes` has no user link; `profiles` does and is secured. The lazy
    // cross-statement match used to report "notes references auth.users".
    const result = scanAuthLinkedMigrationNoRls([
      {
        file: 'supabase/migrations/001.sql',
        content: [
          'create table public.notes (',
          '  id uuid primary key',
          ');',
          'create table public.profiles (id uuid primary key references auth.users (id));',
          'alter table public.profiles enable row level security;',
        ].join('\n'),
      },
    ]);
    expect(result.findings).toEqual([]);
  });

  it('reports the CREATE TABLE line of a multi-line statement after comments', () => {
    const result = scanAuthLinkedMigrationNoRls([
      {
        file: 'supabase/migrations/001.sql',
        content: [
          '-- Profiles, one per signed-up user.',
          '-- Written by hand.',
          '',
          'create table public.profiles (',
          '  id uuid primary key,',
          '  user_id uuid not null references auth.users (id) on delete cascade',
          ');',
        ].join('\n'),
      },
    ]);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]).toMatchObject({
      line: 4,
      message: expect.stringContaining("'profiles'"),
    });
  });

  it('sees RLS enabled by an ALTER TABLE split across lines', () => {
    const result = scanAuthLinkedMigrationNoRls([
      {
        file: 'supabase/migrations/001.sql',
        content: [
          'create table profiles (id uuid references auth.users (id));',
          'alter table profiles',
          '  enable row level security;',
        ].join('\n'),
      },
    ]);
    expect(result.findings).toEqual([]);
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
