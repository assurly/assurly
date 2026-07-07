import { describe, expect, it } from 'vitest';
import { buildShipGateReport } from './shipGate';
import { scanRouteHandlerAuth, scanServerActionAuth, scanServiceRoleBypass } from './authBoundary';

describe('scanServerActionAuth', () => {
  it('flags a mutating Server Action without auth as a review finding', () => {
    const code = [
      "'use server';",
      'export async function deleteAccount(id: string) {',
      '  await db.from("profiles").delete().eq("id", id);',
      '}',
    ].join('\n');

    const result = scanServerActionAuth(code, 'app/actions/account.ts');
    expect(result.findings[0]).toMatchObject({
      ruleId: 'auth-server-action-no-check',
      severity: 'error',
      confidence: 'medium',
    });

    // error + medium routes to review, never a hard blocker.
    const report = buildShipGateReport(result.findings);
    expect(report.blockers).toHaveLength(0);
    expect(report.reviews.some((group) => group.id === 'rule:auth-server-action-no-check')).toBe(
      true,
    );
  });

  it('does not flag when requireUser guards the mutation', () => {
    const code = [
      "'use server';",
      'export async function deleteAccount(req: Request, id: string) {',
      '  await requireUser(req);',
      '  await db.from("profiles").delete().eq("id", id);',
      '}',
    ].join('\n');

    expect(scanServerActionAuth(code, 'app/actions/account.ts').findings).toEqual([]);
  });
});

describe('scanRouteHandlerAuth', () => {
  it('flags protected dashboard routes without session checks as review findings', () => {
    const code = [
      'export async function GET() {',
      '  return Response.json({ ok: true });',
      '}',
    ].join('\n');

    const result = scanRouteHandlerAuth(code, 'app/dashboard/settings/route.ts');
    expect(result.findings[0]).toMatchObject({
      ruleId: 'auth-route-handler-unprotected',
      severity: 'error',
      confidence: 'medium',
    });

    const report = buildShipGateReport(result.findings);
    expect(report.blockers).toHaveLength(0);
    expect(report.reviews.some((group) => group.id === 'rule:auth-route-handler-unprotected')).toBe(
      true,
    );
  });

  it('does not flag protected routes that call getSessionUser', () => {
    const code = [
      'export async function GET(req: Request) {',
      '  const user = await getSessionUser(req);',
      '  if (!user) return new Response(null, { status: 401 });',
      '  return Response.json({ user });',
      '}',
    ].join('\n');

    expect(scanRouteHandlerAuth(code, 'app/dashboard/settings/route.ts').findings).toEqual([]);
  });

  it('does not treat every Next.js App Router route as protected', () => {
    // Regression: `app/` is the App Router root, not a protected area. Public
    // routes (auth callbacks, webhooks, public features) must not fire just
    // because their path contains `app/`.
    const code = 'export async function POST() {\n  return Response.json({ ok: true });\n}';

    expect(
      scanRouteHandlerAuth(code, 'apps/web/src/app/api/auth/callback/route.ts').findings,
    ).toEqual([]);
    expect(
      scanRouteHandlerAuth(code, 'apps/web/src/app/api/stripe/webhook/route.ts').findings,
    ).toEqual([]);
    expect(scanRouteHandlerAuth(code, 'apps/web/src/app/api/contact/route.ts').findings).toEqual(
      [],
    );
  });
});

describe('scanServiceRoleBypass', () => {
  it('flags raw service_role usage without a guard', () => {
    const code = [
      "import { createClient } from '@supabase/supabase-js';",
      'const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY);',
      'export async function wipe() { await admin.from("users").delete(); }',
    ].join('\n');

    const result = scanServiceRoleBypass(code, 'lib/admin.ts');
    expect(result.findings[0]).toMatchObject({
      ruleId: 'auth-service-role-bypass',
      severity: 'error',
      confidence: 'high',
    });
  });

  it('does not flag when getSupabaseAdminConfig guards service_role access', () => {
    const code = [
      "import { createClient } from '@supabase/supabase-js';",
      'export function getAdminDbAdapter() {',
      '  const { url, serviceRoleKey } = getSupabaseAdminConfig();',
      '  return createClient(url, serviceRoleKey);',
      '}',
    ].join('\n');

    expect(scanServiceRoleBypass(code, 'utils/dbAdapter.ts').findings).toEqual([]);
  });

  it('does not flag a mere mention of service_role without client construction', () => {
    // Regression fixtures for real false positives found on the Assurly
    // codebase: a detector comparing a JWT role, and env-var declarations in
    // test config — none of which build a service_role client.
    const detector = "export const isServiceRole = (p) => p?.role === 'service_role';";
    const envList = "const required = ['SUPABASE_SERVICE_ROLE_KEY', 'STRIPE_SECRET'];";
    const envConfig = "export default { env: { SUPABASE_SERVICE_ROLE_KEY: '' } };";

    expect(scanServiceRoleBypass(detector, 'utils/runtimeScanner.ts').findings).toEqual([]);
    expect(scanServiceRoleBypass(envList, 'vitest.setup.ts').findings).toEqual([]);
    expect(scanServiceRoleBypass(envConfig, 'vitest.config.ts').findings).toEqual([]);
  });
});
