import { describe, it, expect } from 'vitest';
import {
  scanSqlMigration,
  scanStripeWebhook,
  scanEnvVariables,
  scanRscDataLeaks,
  scanColdStart,
} from './browserScanner';

// ─── scanSqlMigration ────────────────────────────────────────────────────────

describe('scanSqlMigration', () => {
  describe('Row-Level Security (RLS)', () => {
    it('reports an error when a table is created without RLS enabled', () => {
      const sql = `CREATE TABLE users (id uuid PRIMARY KEY);`;
      const result = scanSqlMigration(sql, 'migration.sql');

      expect(result.errorCount).toBe(1);
      expect(result.findings).toHaveLength(1);
      expect(result.findings[0].severity).toBe('error');
      expect(result.findings[0].message).toContain("'users'");
      expect(result.findings[0].message).toContain('Row-Level Security');
      expect(result.findings[0].file).toBe('migration.sql');
    });

    it('reports no error when a table has RLS enabled', () => {
      const sql = [
        'CREATE TABLE users (id uuid PRIMARY KEY);',
        'ALTER TABLE users ENABLE ROW LEVEL SECURITY;',
      ].join('\n');
      const result = scanSqlMigration(sql, 'migration.sql');

      expect(result.errorCount).toBe(0);
      expect(result.findings).toHaveLength(0);
    });

    it('reports errors only for tables missing RLS when multiple tables exist', () => {
      const sql = [
        'CREATE TABLE users (id uuid PRIMARY KEY);',
        'ALTER TABLE users ENABLE ROW LEVEL SECURITY;',
        'CREATE TABLE posts (id uuid PRIMARY KEY);',
        'CREATE TABLE comments (id uuid PRIMARY KEY);',
        'ALTER TABLE comments ENABLE ROW LEVEL SECURITY;',
      ].join('\n');
      const result = scanSqlMigration(sql, 'migration.sql');

      expect(result.errorCount).toBe(1);
      expect(result.findings).toHaveLength(1);
      expect(result.findings[0].message).toContain("'posts'");
    });

    it('ignores system tables like spatial_ref_sys', () => {
      const sql = [
        'CREATE TABLE spatial_ref_sys (srid integer PRIMARY KEY);',
        'CREATE TABLE geography_columns (id integer PRIMARY KEY);',
        'CREATE TABLE geometry_columns (id integer PRIMARY KEY);',
      ].join('\n');
      const result = scanSqlMigration(sql, 'migration.sql');

      expect(result.errorCount).toBe(0);
      expect(result.findings).toHaveLength(0);
    });
  });

  describe('Dangerous NOT NULL ALTER', () => {
    it('reports an error when adding a NOT NULL column without DEFAULT', () => {
      const sql = `ALTER TABLE users ADD COLUMN name text NOT NULL;`;
      const result = scanSqlMigration(sql, 'migration.sql');

      expect(result.errorCount).toBe(1);
      expect(result.findings[0].severity).toBe('error');
      expect(result.findings[0].message).toContain('Dangerous Migration');
      expect(result.findings[0].message).toContain('NOT NULL');
    });

    it('reports no error when adding a NOT NULL column with DEFAULT', () => {
      const sql = `ALTER TABLE users ADD COLUMN name text NOT NULL DEFAULT '';`;
      const result = scanSqlMigration(sql, 'migration.sql');

      const notNullFindings = result.findings.filter((f) =>
        f.message.includes('Dangerous Migration'),
      );
      expect(notNullFindings).toHaveLength(0);
    });
  });

  describe('edge cases', () => {
    it('returns no findings for empty content', () => {
      const result = scanSqlMigration('', 'empty.sql');

      expect(result.errorCount).toBe(0);
      expect(result.warningCount).toBe(0);
      expect(result.findings).toHaveLength(0);
    });

    it('handles schema-qualified table names with public prefix', () => {
      const sql = [
        'CREATE TABLE public.profiles (id uuid PRIMARY KEY);',
        'ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;',
      ].join('\n');
      const result = scanSqlMigration(sql, 'migration.sql');

      expect(result.errorCount).toBe(0);
      expect(result.findings).toHaveLength(0);
    });
  });
});

// ─── scanStripeWebhook ───────────────────────────────────────────────────────

describe('scanStripeWebhook', () => {
  it('reports an error when a stripe webhook lacks signature verification', () => {
    const code = [
      'import Stripe from "stripe";',
      'const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);',
      'export async function POST(req: Request) {',
      '  const body = await req.json();',
      '  // handle event directly without verification',
      '}',
    ].join('\n');
    const result = scanStripeWebhook(code, 'route.ts');

    expect(result.errorCount).toBe(1);
    expect(result.findings[0].severity).toBe('error');
    expect(result.findings[0].message).toContain('signature verification');
  });

  it('reports no error when constructEvent is used', () => {
    const code = [
      'import Stripe from "stripe";',
      'const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);',
      'export async function POST(req: Request) {',
      '  const body = await req.text();',
      '  const sig = req.headers.get("stripe-signature");',
      '  const event = stripe.webhooks.constructEvent(body, sig, secret);',
      '}',
    ].join('\n');
    const result = scanStripeWebhook(code, 'route.ts');

    expect(result.errorCount).toBe(0);
    expect(result.findings).toHaveLength(0);
  });

  it('reports no error for non-stripe code', () => {
    const code = [
      'export async function GET(req: Request) {',
      '  return Response.json({ status: "ok" });',
      '}',
    ].join('\n');
    const result = scanStripeWebhook(code, 'route.ts');

    expect(result.errorCount).toBe(0);
    expect(result.findings).toHaveLength(0);
  });

  it('reports no error when req is present but stripe is not used', () => {
    const code = [
      'export async function POST(req: Request) {',
      '  const body = await req.json();',
      '  return Response.json(body);',
      '}',
    ].join('\n');
    const result = scanStripeWebhook(code, 'route.ts');

    expect(result.errorCount).toBe(0);
    expect(result.findings).toHaveLength(0);
  });
});

// ─── scanEnvVariables ────────────────────────────────────────────────────────

describe('scanEnvVariables', () => {
  describe('secret key exposure via NEXT_PUBLIC_ prefix', () => {
    it('reports an error for NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY', () => {
      const envExample = 'NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY=your-key-here';
      const code = '';
      const result = scanEnvVariables(envExample, code, '.env.example', 'app.ts');

      expect(result.errorCount).toBe(1);
      expect(result.findings[0].severity).toBe('error');
      expect(result.findings[0].message).toContain('NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY');
      expect(result.findings[0].message).toContain('NEXT_PUBLIC_');
    });

    it('reports an error for NEXT_PUBLIC_STRIPE_SECRET_KEY', () => {
      const envExample = 'NEXT_PUBLIC_STRIPE_SECRET_KEY=sk_test_abc123';
      const code = '';
      const result = scanEnvVariables(envExample, code, '.env.example', 'app.ts');

      // Should trigger both the NEXT_PUBLIC_ error and the hardcoded key error
      const nextPublicFindings = result.findings.filter((f) => f.message.includes('NEXT_PUBLIC_'));
      expect(nextPublicFindings.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('hardcoded secrets', () => {
    it('reports an error for a hardcoded sk_live_ key', () => {
      const fakeLiveKey = `sk_${'live'}_${'a'.repeat(24)}`;
      const envExample = `STRIPE_SECRET_KEY=${fakeLiveKey}`;
      const code = '';
      const result = scanEnvVariables(envExample, code, '.env.example', 'app.ts');

      expect(result.errorCount).toBe(1);
      expect(result.findings[0].severity).toBe('error');
      expect(result.findings[0].message).toContain('CRITICAL KEY LEAK');
      expect(result.findings[0].message).toContain('Hardcoded Stripe secret key');
    });
  });

  describe('undocumented environment variables', () => {
    it('reports an error when process.env.VAR is used but not in .env.example', () => {
      const envExample = 'DATABASE_URL=postgres://localhost';
      const code = 'const key = process.env.STRIPE_API_KEY;';
      const result = scanEnvVariables(envExample, code, '.env.example', 'config.ts');

      expect(result.errorCount).toBe(1);
      expect(result.findings[0].message).toContain('STRIPE_API_KEY');
      expect(result.findings[0].message).toContain("not documented in '.env.example'");
      expect(result.findings[0].file).toBe('config.ts');
    });

    it('reports no error when process.env.VAR is documented in .env.example', () => {
      const envExample = 'DATABASE_URL=postgres://localhost';
      const code = 'const url = process.env.DATABASE_URL;';
      const result = scanEnvVariables(envExample, code, '.env.example', 'config.ts');

      expect(result.errorCount).toBe(0);
      expect(result.findings).toHaveLength(0);
    });

    it('ignores system environment variables like NODE_ENV and PORT', () => {
      const envExample = '';
      const code = [
        'const env = process.env.NODE_ENV;',
        'const port = process.env.PORT;',
        'const vercel = process.env.VERCEL_ENV;',
        'const runtime = process.env.NEXT_RUNTIME;',
      ].join('\n');
      const result = scanEnvVariables(envExample, code, '.env.example', 'config.ts');

      expect(result.errorCount).toBe(0);
      expect(result.findings).toHaveLength(0);
    });
  });

  describe('clean configuration', () => {
    it('returns no findings when env config is properly set up', () => {
      const envExample = [
        '# Database',
        'DATABASE_URL=postgres://localhost',
        '# Auth',
        'AUTH_SECRET=',
      ].join('\n');
      const code = [
        'const db = process.env.DATABASE_URL;',
        'const secret = process.env.AUTH_SECRET;',
      ].join('\n');
      const result = scanEnvVariables(envExample, code, '.env.example', 'config.ts');

      expect(result.errorCount).toBe(0);
      expect(result.warningCount).toBe(0);
      expect(result.findings).toHaveLength(0);
    });
  });
});

// ─── scanRscDataLeaks ────────────────────────────────────────────────────────

describe('scanRscDataLeaks', () => {
  describe('client component with server-side imports', () => {
    it('reports an error when "use client" imports @prisma/client', () => {
      const code = ['"use client";', 'import { PrismaClient } from "@prisma/client";'].join('\n');
      const result = scanRscDataLeaks(code, 'UserForm.tsx');

      expect(result.errorCount).toBe(1);
      expect(result.findings[0].severity).toBe('error');
      expect(result.findings[0].message).toContain('@prisma/client');
      expect(result.findings[0].message).toContain('Client Component');
    });

    it('reports an error when "use client" imports server-only', () => {
      const code = [
        '"use client";',
        'import serverOnly from "server-only";',
        '',
        'export default function Component() {}',
      ].join('\n');
      const result = scanRscDataLeaks(code, 'ClientComp.tsx');

      expect(result.errorCount).toBe(1);
      expect(result.findings[0].message).toContain('server-only');
    });

    it('reports an error when "use client" imports a local db module', () => {
      const code = ['"use client";', 'import { db } from "@/lib/db";'].join('\n');
      const result = scanRscDataLeaks(code, 'Dashboard.tsx');

      expect(result.errorCount).toBe(1);
      expect(result.findings[0].message).toContain('@/lib/db');
    });

    it('reports no error when "use client" only has safe imports', () => {
      const code = [
        '"use client";',
        'import { useState } from "react";',
        'import { Button } from "@/components/ui/button";',
        'import clsx from "clsx";',
      ].join('\n');
      const result = scanRscDataLeaks(code, 'SafeClient.tsx');

      expect(result.errorCount).toBe(0);
      expect(result.findings).toHaveLength(0);
    });
  });

  describe('server component with sensitive props', () => {
    it('reports a warning when a server component passes a password prop', () => {
      const code = [
        'export default async function Page() {',
        '  const user = await getUser();',
        '  return <UserCard password={user.password} />;',
        '}',
      ].join('\n');
      const result = scanRscDataLeaks(code, 'Page.tsx');

      expect(result.warningCount).toBe(1);
      expect(result.findings[0].severity).toBe('warning');
      expect(result.findings[0].message).toContain('password');
      expect(result.findings[0].message).toContain('Potential Data Leak');
    });

    it('returns no findings when a server component has no sensitive props', () => {
      const code = [
        'export default async function Page() {',
        '  const user = await getUser();',
        '  return <UserCard name={user.name} email={user.email} />;',
        '}',
      ].join('\n');
      const result = scanRscDataLeaks(code, 'Page.tsx');

      expect(result.errorCount).toBe(0);
      expect(result.warningCount).toBe(0);
      expect(result.findings).toHaveLength(0);
    });

    it('returns no findings for a regular server component without JSX props', () => {
      const code = [
        'export default async function Page() {',
        '  const data = await fetch("/api/data");',
        '  return <div>Hello</div>;',
        '}',
      ].join('\n');
      const result = scanRscDataLeaks(code, 'Page.tsx');

      expect(result.errorCount).toBe(0);
      expect(result.warningCount).toBe(0);
      expect(result.findings).toHaveLength(0);
    });
  });
});

// ─── scanColdStart ───────────────────────────────────────────────────────────

describe('scanColdStart', () => {
  describe('heavy import detection', () => {
    it('reports a warning for lodash import', () => {
      const code = 'import _ from "lodash";';
      const result = scanColdStart(code, 'route.ts');

      expect(result.warningCount).toBe(1);
      expect(result.findings[0].severity).toBe('warning');
      expect(result.findings[0].message).toContain('lodash');
    });

    it('reports a warning for aws-sdk import', () => {
      const code = 'import AWS from "aws-sdk";';
      const result = scanColdStart(code, 'handler.ts');

      expect(result.warningCount).toBe(1);
      expect(result.findings[0].message).toContain('aws-sdk');
    });

    it('reports a warning for moment import', () => {
      const code = 'import moment from "moment";';
      const result = scanColdStart(code, 'utils.ts');

      expect(result.warningCount).toBe(1);
      expect(result.findings[0].message).toContain('moment');
    });

    it('reports a warning for firebase import', () => {
      const code = 'import firebase from "firebase";';
      const result = scanColdStart(code, 'auth.ts');

      expect(result.warningCount).toBe(1);
      expect(result.findings[0].message).toContain('firebase');
    });
  });

  describe('lightweight imports', () => {
    it('reports no warning for date-fns import', () => {
      const code = 'import { format } from "date-fns";';
      const result = scanColdStart(code, 'route.ts');

      expect(result.warningCount).toBe(0);
      expect(result.findings).toHaveLength(0);
    });
  });

  describe('edge cases', () => {
    it('returns no findings when there are no imports', () => {
      const code = ['export function handler() {', '  return { status: 200 };', '}'].join('\n');
      const result = scanColdStart(code, 'route.ts');

      expect(result.errorCount).toBe(0);
      expect(result.warningCount).toBe(0);
      expect(result.findings).toHaveLength(0);
    });
  });
});
