import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { envRules } from './envRules';
import { supabaseRules } from './supabaseRules';
import { stripeRules } from './stripeRules';
import { vercelRules } from './vercelRules';
import { ciRules } from './ciRules';
import { tsconfigRules } from './tsconfigRules';
import { dbPoolRules } from './dbPoolRules';
import { rscRules } from './rscRules';
import { coldStartRules } from './coldStartRules';
import { sqlSafetyRules } from './sqlSafetyRules';
import { ProjectContext } from '../types';

const FIXTURE_DIR = path.resolve(__dirname, '../../test-fixtures');

function ensureDir(dirPath: string) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

describe('Assurly Verification Rules', () => {
  beforeAll(() => {
    // Setup test fixture folder structure
    ensureDir(FIXTURE_DIR);
    ensureDir(path.join(FIXTURE_DIR, 'src'));
    ensureDir(path.join(FIXTURE_DIR, 'supabase/migrations'));
    ensureDir(path.join(FIXTURE_DIR, 'app/api/webhooks'));
    ensureDir(path.join(FIXTURE_DIR, 'app/api/edge-route'));
  });

  afterAll(() => {
    // Clean up test fixtures
    if (fs.existsSync(FIXTURE_DIR)) {
      fs.rmSync(FIXTURE_DIR, { recursive: true, force: true });
    }
  });

  describe('Environment Variables Validation (envRules)', () => {
    it('should warn if .env.example is missing', async () => {
      const context: ProjectContext = {
        projectPath: FIXTURE_DIR,
        detectedStack: {
          framework: 'nextjs',
          database: 'none',
          payments: 'none',
          deployment: 'vercel',
        },
        files: [],
      };

      const findings = await envRules.run(context);
      expect(findings.length).toBe(1);
      expect(findings[0].severity).toBe('warning');
      expect(findings[0].message).toContain('No .env.example file found');
    });

    it('should error on undocumented env variables used in code', async () => {
      // Create env.example and a source file referencing an undocumented variable
      fs.writeFileSync(path.join(FIXTURE_DIR, '.env.example'), 'PORT=3000\nDATABASE_URL=\n');
      fs.writeFileSync(
        path.join(FIXTURE_DIR, 'src/index.ts'),
        'const key = process.env.STRIPE_SECRET_KEY;\nconsole.log(process.env.PORT);',
      );

      const context: ProjectContext = {
        projectPath: FIXTURE_DIR,
        detectedStack: {
          framework: 'nextjs',
          database: 'none',
          payments: 'none',
          deployment: 'vercel',
        },
        files: ['.env.example', 'src/index.ts'],
      };

      const findings = await envRules.run(context);
      // Should flag process.env.STRIPE_SECRET_KEY as missing from example
      expect(findings.length).toBe(1);
      expect(findings[0].severity).toBe('error');
      expect(findings[0].message).toContain('STRIPE_SECRET_KEY');
    });
  });

  describe('Supabase Security Checks (supabaseRules)', () => {
    it('should flag tables missing RLS configuration', async () => {
      // Create migration file with table creation but no RLS alter statement
      fs.writeFileSync(
        path.join(FIXTURE_DIR, 'supabase/migrations/01_init.sql'),
        'CREATE TABLE profiles (id uuid primary key, username text);\nCREATE TABLE posts (id uuid); ALTER TABLE posts ENABLE ROW LEVEL SECURITY;',
      );

      const context: ProjectContext = {
        projectPath: FIXTURE_DIR,
        detectedStack: {
          framework: 'nextjs',
          database: 'supabase',
          payments: 'none',
          deployment: 'vercel',
        },
        files: ['supabase/migrations/01_init.sql'],
      };

      const findings = await supabaseRules.run(context);
      // Profiles should fail, posts should pass
      expect(findings.length).toBe(1);
      expect(findings[0].severity).toBe('error');
      expect(findings[0].message).toContain(
        "table 'profiles' is created in migration files, but Row-Level Security (RLS) is not enabled",
      );
    });

    it('should flag service_role leaks in frontend', async () => {
      fs.writeFileSync(
        path.join(FIXTURE_DIR, 'src/ClientComp.tsx'),
        '"use client";\nconst supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;',
      );

      const context: ProjectContext = {
        projectPath: FIXTURE_DIR,
        detectedStack: {
          framework: 'nextjs',
          database: 'supabase',
          payments: 'none',
          deployment: 'vercel',
        },
        files: ['src/ClientComp.tsx'],
      };

      const findings = await supabaseRules.run(context);
      expect(findings.length).toBe(1);
      expect(findings[0].severity).toBe('error');
      expect(findings[0].message).toContain('Potential service_role key leakage');
    });
  });

  describe('Stripe Security Checks (stripeRules)', () => {
    it('should flag Stripe webhooks lacking signature verification', async () => {
      fs.writeFileSync(
        path.join(FIXTURE_DIR, 'app/api/webhooks/route.ts'),
        'import stripe from "stripe";\nexport async function POST(req: Request) {\n  const body = await req.json();\n}',
      );

      const context: ProjectContext = {
        projectPath: FIXTURE_DIR,
        detectedStack: {
          framework: 'nextjs',
          database: 'none',
          payments: 'stripe',
          deployment: 'vercel',
        },
        files: ['app/api/webhooks/route.ts'],
      };

      const findings = await stripeRules.run(context);
      expect(findings.length).toBe(1);
      expect(findings[0].severity).toBe('error');
      expect(findings[0].message).toContain(
        'webhook endpoint appears to lack signature verification',
      );
    });

    it('should flag hardcoded secret keys', async () => {
      fs.writeFileSync(
        path.join(FIXTURE_DIR, 'src/stripe-helper.ts'),
        'const key = "sk_test_51NzYABCDEF1234567890abcdefghijklmnop";',
      );

      const context: ProjectContext = {
        projectPath: FIXTURE_DIR,
        detectedStack: {
          framework: 'nextjs',
          database: 'none',
          payments: 'stripe',
          deployment: 'vercel',
        },
        files: ['src/stripe-helper.ts'],
      };

      const findings = await stripeRules.run(context);
      expect(findings.length).toBe(1);
      expect(findings[0].severity).toBe('error');
      expect(findings[0].message).toContain('Hardcoded Stripe secret key found');
    });
  });

  describe('Vercel Edge compatibility (vercelRules)', () => {
    it('should flag Node.js imports in Edge Runtime route files', async () => {
      fs.writeFileSync(
        path.join(FIXTURE_DIR, 'app/api/edge-route/route.ts'),
        'import fs from "fs";\nexport const runtime = "edge";',
      );

      const context: ProjectContext = {
        projectPath: FIXTURE_DIR,
        detectedStack: {
          framework: 'nextjs',
          database: 'none',
          payments: 'none',
          deployment: 'vercel',
        },
        files: ['app/api/edge-route/route.ts'],
      };

      const findings = await vercelRules.run(context);
      expect(findings.length).toBe(1);
      expect(findings[0].severity).toBe('error');
      expect(findings[0].message).toContain(
        "declares Edge Runtime but imports Node-only module 'fs'",
      );
    });
  });

  describe('GitHub Actions CI/CD Integration (ciRules)', () => {
    it('should flag warning when .github/workflows/assurly.yml is missing', async () => {
      const context: ProjectContext = {
        projectPath: FIXTURE_DIR,
        detectedStack: {
          framework: 'nextjs',
          database: 'none',
          payments: 'none',
          deployment: 'vercel',
        },
        files: [],
      };

      const findings = await ciRules.run(context);
      expect(findings.length).toBe(1);
      expect(findings[0].severity).toBe('warning');
      expect(findings[0].message).toContain('GitHub Actions workflow for Assurly is missing');
      expect(findings[0].suggestion).toContain('npx assurly init');
    });

    it('should pass (no warnings) when .github/workflows/assurly.yml is present', async () => {
      const githubDir = path.join(FIXTURE_DIR, '.github');
      const workflowsDir = path.join(githubDir, 'workflows');
      const workflowFile = path.join(workflowsDir, 'assurly.yml');

      if (!fs.existsSync(githubDir)) {
        fs.mkdirSync(githubDir, { recursive: true });
      }
      if (!fs.existsSync(workflowsDir)) {
        fs.mkdirSync(workflowsDir, { recursive: true });
      }
      fs.writeFileSync(
        workflowFile,
        'name: Assurly\njobs:\n  scan:\n    steps:\n      - run: npx assurly scan\n',
        'utf8',
      );

      const context: ProjectContext = {
        projectPath: FIXTURE_DIR,
        detectedStack: {
          framework: 'nextjs',
          database: 'none',
          payments: 'none',
          deployment: 'vercel',
        },
        files: ['.github/workflows/assurly.yml'],
      };

      const findings = await ciRules.run(context);
      expect(findings.length).toBe(0);

      // Clean up the created files so it does not pollute other tests
      fs.rmSync(githubDir, { recursive: true, force: true });
    });
  });

  describe('TypeScript Strict Mode (tsconfigRules)', () => {
    it('should warn if tsconfig.json is missing', async () => {
      const context: ProjectContext = {
        projectPath: FIXTURE_DIR,
        detectedStack: {
          framework: 'nextjs',
          database: 'none',
          payments: 'none',
          deployment: 'vercel',
        },
        files: [],
      };

      const findings = await tsconfigRules.run(context);
      expect(findings.length).toBe(1);
      expect(findings[0].severity).toBe('warning');
      expect(findings[0].message).toContain('No tsconfig.json file found');
    });

    it('should warn if strict: true is missing in tsconfig.json', async () => {
      const tsconfigPath = path.join(FIXTURE_DIR, 'tsconfig.json');
      fs.writeFileSync(
        tsconfigPath,
        JSON.stringify({ compilerOptions: { target: 'es6' } }),
        'utf8',
      );

      const context: ProjectContext = {
        projectPath: FIXTURE_DIR,
        detectedStack: {
          framework: 'nextjs',
          database: 'none',
          payments: 'none',
          deployment: 'vercel',
        },
        files: ['tsconfig.json'],
      };

      const findings = await tsconfigRules.run(context);
      expect(findings.length).toBe(1);
      expect(findings[0].severity).toBe('warning');
      expect(findings[0].message).toContain('strict mode is disabled or not set');

      fs.rmSync(tsconfigPath, { force: true });
    });

    it('should pass if strict: true is set in tsconfig.json', async () => {
      const tsconfigPath = path.join(FIXTURE_DIR, 'tsconfig.json');
      fs.writeFileSync(tsconfigPath, JSON.stringify({ compilerOptions: { strict: true } }), 'utf8');

      const context: ProjectContext = {
        projectPath: FIXTURE_DIR,
        detectedStack: {
          framework: 'nextjs',
          database: 'none',
          payments: 'none',
          deployment: 'vercel',
        },
        files: ['tsconfig.json'],
      };

      const findings = await tsconfigRules.run(context);
      expect(findings.length).toBe(0);

      fs.rmSync(tsconfigPath, { force: true });
    });

    it('should parse tsconfig.json containing comments', async () => {
      const tsconfigPath = path.join(FIXTURE_DIR, 'tsconfig.json');
      fs.writeFileSync(
        tsconfigPath,
        `{\n  // This is a test comment\n  "compilerOptions": {\n    "strict": true /* inline comment */\n  }\n}`,
        'utf8',
      );

      const context: ProjectContext = {
        projectPath: FIXTURE_DIR,
        detectedStack: {
          framework: 'nextjs',
          database: 'none',
          payments: 'none',
          deployment: 'vercel',
        },
        files: ['tsconfig.json'],
      };

      const findings = await tsconfigRules.run(context);
      expect(findings.length).toBe(0);

      fs.rmSync(tsconfigPath, { force: true });
    });
  });

  describe('Database Connection Pooling (dbPoolRules)', () => {
    it('should flag an error if PrismaClient is instantiated inside a handler function', async () => {
      const routePath = path.join(FIXTURE_DIR, 'app/api/route-db-test/route.ts');
      const routeDir = path.dirname(routePath);
      if (!fs.existsSync(routeDir)) {
        fs.mkdirSync(routeDir, { recursive: true });
      }
      fs.writeFileSync(
        routePath,
        `import { PrismaClient } from '@prisma/client';\n\nexport async function GET() {\n  const prisma = new PrismaClient();\n  return Response.json({ success: true });\n}`,
        'utf8',
      );

      const context: ProjectContext = {
        projectPath: FIXTURE_DIR,
        detectedStack: {
          framework: 'nextjs',
          database: 'prisma',
          payments: 'none',
          deployment: 'vercel',
        },
        files: ['app/api/route-db-test/route.ts'],
      };

      const findings = await dbPoolRules.run(context);
      expect(findings.length).toBe(1);
      expect(findings[0].severity).toBe('error');
      expect(findings[0].message).toContain("instantiated inside function 'GET'");

      fs.rmSync(routePath, { force: true });
    });

    it('should flag an error if pg.Pool is instantiated inside an arrow function assigned to GET', async () => {
      const routePath = path.join(FIXTURE_DIR, 'pages/api/pool-test.ts');
      const routeDir = path.dirname(routePath);
      if (!fs.existsSync(routeDir)) {
        fs.mkdirSync(routeDir, { recursive: true });
      }
      fs.writeFileSync(
        routePath,
        `import { Pool } from 'pg';\n\nexport const GET = async (req, res) => {\n  const pool = new Pool();\n  res.status(200).json({ ok: true });\n}`,
        'utf8',
      );

      const context: ProjectContext = {
        projectPath: FIXTURE_DIR,
        detectedStack: {
          framework: 'nextjs',
          database: 'none',
          payments: 'none',
          deployment: 'vercel',
        },
        files: ['pages/api/pool-test.ts'],
      };

      const findings = await dbPoolRules.run(context);
      expect(findings.length).toBe(1);
      expect(findings[0].severity).toBe('error');
      expect(findings[0].message).toContain("instantiated inside function 'GET'");

      fs.rmSync(routePath, { force: true });
    });

    it('should pass if PrismaClient is instantiated in global scope', async () => {
      const routePath = path.join(FIXTURE_DIR, 'app/api/route-db-ok/route.ts');
      const routeDir = path.dirname(routePath);
      if (!fs.existsSync(routeDir)) {
        fs.mkdirSync(routeDir, { recursive: true });
      }
      fs.writeFileSync(
        routePath,
        `import { PrismaClient } from '@prisma/client';\nconst prisma = new PrismaClient();\n\nexport async function GET() {\n  return Response.json({ count: 42 });\n}`,
        'utf8',
      );

      const context: ProjectContext = {
        projectPath: FIXTURE_DIR,
        detectedStack: {
          framework: 'nextjs',
          database: 'prisma',
          payments: 'none',
          deployment: 'vercel',
        },
        files: ['app/api/route-db-ok/route.ts'],
      };

      const findings = await dbPoolRules.run(context);
      expect(findings.length).toBe(0);

      fs.rmSync(routePath, { force: true });
    });
  });

  describe('React Server Components (RSC) Data Leaks (rscRules)', () => {
    it('should flag an error if a Client Component imports server-only or DB client', async () => {
      const filePath = path.join(FIXTURE_DIR, 'src/ClientComponent.tsx');
      fs.writeFileSync(
        filePath,
        `"use client";\nimport { PrismaClient } from '@prisma/client';\nimport { something } from 'server-only';\nexport function Client() { return <div />;\n}`,
        'utf8',
      );

      const context: ProjectContext = {
        projectPath: FIXTURE_DIR,
        detectedStack: {
          framework: 'nextjs',
          database: 'prisma',
          payments: 'none',
          deployment: 'vercel',
        },
        files: ['src/ClientComponent.tsx'],
      };

      const findings = await rscRules.run(context);
      expect(findings.length).toBe(2);
      expect(findings[0].severity).toBe('error');
      expect(findings[0].message).toContain('imports server-side module');
      expect(findings[1].message).toContain('imports server-side module');

      fs.rmSync(filePath, { force: true });
    });

    it('should warn if a Server Component passes sensitive props in JSX', async () => {
      const filePath = path.join(FIXTURE_DIR, 'src/ServerComponent.tsx');
      fs.writeFileSync(
        filePath,
        `export function Server() {\n  const user = { password: '123' };\n  return <Child password={user.password} token={user.token} />;\n}`,
        'utf8',
      );

      const context: ProjectContext = {
        projectPath: FIXTURE_DIR,
        detectedStack: {
          framework: 'nextjs',
          database: 'none',
          payments: 'none',
          deployment: 'vercel',
        },
        files: ['src/ServerComponent.tsx'],
      };

      const findings = await rscRules.run(context);
      expect(findings.length).toBe(2);
      expect(findings[0].severity).toBe('warning');
      expect(findings[0].message).toContain('Potential Data Leak');

      fs.rmSync(filePath, { force: true });
    });
  });

  describe('Cold Start Optimization (coldStartRules)', () => {
    it('should warn if heavy libraries are imported directly in API routes', async () => {
      const filePath = path.join(FIXTURE_DIR, 'app/api/heavy/route.ts');
      const dirPath = path.dirname(filePath);
      if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
      }
      fs.writeFileSync(
        filePath,
        `import _ from 'lodash';\nimport AWS from 'aws-sdk';\nimport moment from 'moment';\nexport async function GET() { return Response.json({ ok: true }); }`,
        'utf8',
      );

      const context: ProjectContext = {
        projectPath: FIXTURE_DIR,
        detectedStack: {
          framework: 'nextjs',
          database: 'none',
          payments: 'none',
          deployment: 'vercel',
        },
        files: ['app/api/heavy/route.ts'],
      };

      const findings = await coldStartRules.run(context);
      expect(findings.length).toBe(3);
      expect(findings[0].severity).toBe('warning');
      expect(findings[0].message).toContain("entire 'lodash' library");
      expect(findings[1].message).toContain("legacy 'aws-sdk'");
      expect(findings[2].message).toContain('moment');

      fs.rmSync(filePath, { force: true });
    });
  });

  describe('Database Migration Safety (sqlSafetyRules)', () => {
    it('should flag an error if NOT NULL column is added without a DEFAULT constraint', async () => {
      const filePath = path.join(FIXTURE_DIR, 'supabase/migrations/02_unsafe.sql');
      fs.writeFileSync(
        filePath,
        `-- Unsafe alter\nALTER TABLE profiles ADD COLUMN api_key TEXT NOT NULL;\n-- Safe alter\nALTER TABLE profiles ADD COLUMN created_at TIMESTAMP NOT NULL DEFAULT NOW();`,
        'utf8',
      );

      const context: ProjectContext = {
        projectPath: FIXTURE_DIR,
        detectedStack: {
          framework: 'nextjs',
          database: 'supabase',
          payments: 'none',
          deployment: 'vercel',
        },
        files: ['supabase/migrations/02_unsafe.sql'],
      };

      const findings = await sqlSafetyRules.run(context);
      expect(findings.length).toBe(1);
      expect(findings[0].severity).toBe('error');
      expect(findings[0].message).toContain('Dangerous Migration');

      fs.rmSync(filePath, { force: true });
    });
  });
});
