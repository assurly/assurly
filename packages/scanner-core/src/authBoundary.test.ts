import { describe, expect, it } from 'vitest';
import { buildShipGateReport } from './shipGate';
import {
  scanAuthBoundary,
  scanRouteHandlerAuth,
  scanServerActionAuth,
  scanServiceRoleBypass,
} from './authBoundary';

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

  it('does not flag a signature-verified webhook that lives under a protected path', () => {
    // Corpus case secured-saas-ready: Stripe calls /api/billing/webhook with no
    // session; the signature over the raw body is its authentication.
    const code = [
      'export async function POST(request: Request) {',
      "  const signature = request.headers.get('stripe-signature');",
      '  const event = stripe.webhooks.constructEvent(await request.text(), signature, secret);',
      '  return new Response(event.id);',
      '}',
    ].join('\n');

    expect(scanRouteHandlerAuth(code, 'app/api/billing/webhook/route.ts').findings).toEqual([]);
  });

  it('does not flag a route wrapped in secureRoute with auth required', () => {
    const code = [
      "import { secureRoute } from '../../../utils/apiSecurity';",
      'export const POST = secureRoute(',
      "  { routeId: 'settings:update', auth: 'required', body: settingsBody },",
      '  async ({ body }) => {',
      '    await db.from("settings").update(body);',
      '    return Response.json({ ok: true });',
      '  },',
      ');',
    ].join('\n');

    expect(scanRouteHandlerAuth(code, 'app/dashboard/settings/route.ts').findings).toEqual([]);
  });
});

describe('scanRouteHandlerAuth — unguarded mutations outside protected paths', () => {
  const mutatingOrdersRoute = [
    'export async function POST() {',
    '  await db.from("orders").insert({ status: "new" });',
    '  return Response.json({ ok: true });',
    '}',
  ].join('\n');

  it('flags a mutating route handler with no guard, whatever the path is named', () => {
    const result = scanRouteHandlerAuth(mutatingOrdersRoute, 'app/api/orders/route.ts');

    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]).toMatchObject({
      ruleId: 'auth-route-handler-mutates-unguarded',
      severity: 'error',
      confidence: 'medium',
    });

    // error + medium routes to review, never a hard blocker.
    const report = buildShipGateReport(result.findings);
    expect(report.blockers).toHaveLength(0);
  });

  it('does not flag when secureRoute requires authentication', () => {
    const code = [
      "import { secureRoute } from '../../../utils/apiSecurity';",
      'export const POST = secureRoute(',
      "  { routeId: 'orders:create', auth: 'required', body: orderBody },",
      '  async ({ body }) => {',
      '    await db.from("orders").insert(body);',
      '    return Response.json({ ok: true });',
      '  },',
      ');',
    ].join('\n');

    expect(scanRouteHandlerAuth(code, 'app/api/orders/route.ts').findings).toEqual([]);
  });

  it('still flags a secureRoute wrapper that authenticates nobody', () => {
    // `secureRoute` on its own is rate limiting and body parsing, not auth —
    // an `auth: 'none'` route that writes is exactly what this rule is for.
    const code = [
      "import { secureRoute } from '../../../utils/apiSecurity';",
      'export const POST = secureRoute(',
      "  { routeId: 'orders:create', auth: 'none', body: orderBody },",
      '  async ({ body }) => {',
      '    await db.from("orders").insert(body);',
      '    return Response.json({ ok: true });',
      '  },',
      ');',
    ].join('\n');

    expect(scanRouteHandlerAuth(code, 'app/api/orders/route.ts').findings[0]).toMatchObject({
      ruleId: 'auth-route-handler-mutates-unguarded',
    });
  });

  it('does not flag when getServerSession guards the mutation', () => {
    const code = [
      'export async function POST() {',
      '  const session = await getServerSession();',
      '  if (!session) return new Response(null, { status: 401 });',
      '  await db.from("orders").insert({ status: "new" });',
      '  return Response.json({ ok: true });',
      '}',
    ].join('\n');

    expect(scanRouteHandlerAuth(code, 'app/api/orders/route.ts').findings).toEqual([]);
  });

  it('does not flag a signature-verified webhook that mutates', () => {
    const code = [
      'export async function POST(request: Request) {',
      '  const raw = await readRawBody(request);',
      '  const event = stripe.webhooks.constructEvent(raw, signature, secret);',
      '  await db.from("payments").insert({ id: event.id });',
      '  return Response.json({ received: true });',
      '}',
    ].join('\n');

    expect(
      scanRouteHandlerAuth(code, 'apps/web/src/app/api/stripe/webhook/route.ts').findings,
    ).toEqual([]);
  });

  it('does not flag auth callbacks or cron entries that mutate', () => {
    const callback = [
      'export async function GET() {',
      '  await db.from("sessions").insert({ id });',
      '  return Response.redirect("/dashboard");',
      '}',
    ].join('\n');
    const cron = [
      'export async function POST(request: Request) {',
      '  if (request.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {',
      '    return new Response(null, { status: 403 });',
      '  }',
      '  await db.from("jobs").update({ ran: true });',
      '  return Response.json({ ok: true });',
      '}',
    ].join('\n');

    expect(scanRouteHandlerAuth(callback, 'app/api/auth/callback/route.ts').findings).toEqual([]);
    expect(scanRouteHandlerAuth(cron, 'app/api/cron/guardian/route.ts').findings).toEqual([]);
  });

  it('reports the line of the exported handler, not line 1', () => {
    const code = [
      "import { db } from '../../../lib/db';",
      '',
      'export async function POST() {',
      '  await db.from("orders").insert({ status: "new" });',
      '  return Response.json({ ok: true });',
      '}',
    ].join('\n');

    expect(scanRouteHandlerAuth(code, 'app/api/orders/route.ts').findings[0]?.line).toBe(3);
  });

  it('reports the line of a handler exported as a const', () => {
    const code = [
      "import { db } from '../../../lib/db';",
      '',
      'const insertOrder = (body) => db.from("orders").insert(body);',
      '',
      'export const POST = async (request: Request) => {',
      '  await insertOrder(await parseBody(request));',
      '  return Response.json({ ok: true });',
      '};',
    ].join('\n');

    expect(scanRouteHandlerAuth(code, 'app/api/orders/route.ts').findings[0]?.line).toBe(5);
  });
});

describe('scanRouteHandlerAuth — unvalidated request input', () => {
  it('flags a route that reads the request body without schema validation', () => {
    const code = [
      'export async function POST(request: Request) {',
      '  const body = await request.json();',
      '  await sendEmail(body);',
      '  return Response.json({ ok: true });',
      '}',
    ].join('\n');

    const result = scanRouteHandlerAuth(code, 'app/api/contact/route.ts');
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]).toMatchObject({
      ruleId: 'api-route-unvalidated-input',
      severity: 'warning',
      confidence: 'medium',
    });
  });

  it('does not flag when the body is parsed through a schema', () => {
    const code = [
      'export async function POST(request: Request) {',
      '  const parsed = contactSchema.safeParse(await request.json());',
      '  if (!parsed.success) return new Response(null, { status: 400 });',
      '  await sendEmail(parsed.data);',
      '  return Response.json({ ok: true });',
      '}',
    ].join('\n');

    expect(scanRouteHandlerAuth(code, 'app/api/contact/route.ts').findings).toEqual([]);
  });

  it('does not flag a GET route that never reads a body', () => {
    const code = [
      'export async function GET() {',
      '  return Response.json({ items: [] });',
      '}',
    ].join('\n');

    expect(scanRouteHandlerAuth(code, 'app/api/orders/route.ts').findings).toEqual([]);
  });

  // `JSON.parse` decodes; it validates nothing. A `.parse(` match that accepts
  // it would let the most common hand-rolled body read through unflagged.
  it('does not treat JSON.parse as schema validation', () => {
    const code = [
      'export async function POST(request: Request) {',
      '  const body = JSON.parse(await request.text());',
      '  await sendEmail(body);',
      '  return Response.json({ ok: true });',
      '}',
    ].join('\n');

    const ruleIds = scanRouteHandlerAuth(code, 'app/api/contact/route.ts').findings.map(
      (finding) => finding.ruleId,
    );
    expect(ruleIds).toContain('api-route-unvalidated-input');
  });

  // A provider webhook must read the raw body to check its signature; the
  // signature IS the validation. Every Stripe integration does exactly this.
  it('does not flag a signature-verified webhook for reading the raw body', () => {
    const code = [
      'export async function POST(request: Request) {',
      '  const payload = await request.text();',
      "  const signature = request.headers.get('stripe-signature') ?? '';",
      '  const event = stripe.webhooks.constructEvent(payload, signature, secret);',
      '  await handle(event);',
      '  return Response.json({ received: true });',
      '}',
    ].join('\n');

    expect(scanRouteHandlerAuth(code, 'app/api/stripe/webhook/route.ts').findings).toEqual([]);
  });
});

describe('scanAuthBoundary', () => {
  it('inherits both behaviour rules through the combined entry point', () => {
    const code = [
      'export async function POST(request: Request) {',
      '  const body = await request.json();',
      '  await db.from("orders").insert(body);',
      '  return Response.json({ ok: true });',
      '}',
    ].join('\n');

    const ruleIds = scanAuthBoundary(code, 'app/api/orders/route.ts').findings.map(
      (item) => item.ruleId,
    );
    expect(ruleIds).toContain('auth-route-handler-mutates-unguarded');
    expect(ruleIds).toContain('api-route-unvalidated-input');
  });
});

describe('scanServiceRoleBypass', () => {
  it('accepts an edge function that verifies the caller JWT on its own client (Anima)', () => {
    const code = [
      "import { createClient } from 'jsr:@supabase/supabase-js@2';",
      'Deno.serve(async (req) => {',
      '  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");',
      '  const authHeader = req.headers.get("Authorization");',
      '  if (!authHeader?.startsWith("Bearer ")) return jsonResponse({ ok: false }, 401);',
      '  const userClient = createClient(url, anonKey, {',
      '    global: { headers: { Authorization: authHeader } },',
      '  });',
      '  const { data: { user } } = await userClient.auth.getUser();',
      '  if (!user) return jsonResponse({ ok: false }, 401);',
      '  const adminClient = createClient(url, serviceRoleKey);',
      '  await adminClient.auth.admin.deleteUser(user.id);',
      '});',
    ].join('\n');

    expect(
      scanServiceRoleBypass(code, 'supabase/functions/delete-user-account/index.ts').findings,
    ).toEqual([]);
  });

  it('still flags a cron edge function anyone holding the anon key can call', () => {
    const code = [
      'Deno.serve(async () => {',
      '  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");',
      '  const admin = createClient(url, key);',
      '  await admin.from("profiles").update({ messages_today: 0 });',
      '});',
    ].join('\n');

    expect(
      scanServiceRoleBypass(code, 'supabase/functions/reset-daily-messages/index.ts').findings,
    ).toHaveLength(1);
  });

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

  it('points a service_role bypass at the client it builds, not line 1', () => {
    const code = [
      '// Admin helpers.',
      "import { createClient } from '@supabase/supabase-js';",
      "import { createServerClient } from '@supabase/ssr';",
      '',
      'export const anon = createServerClient(url, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);',
      'export function wipe() {',
      '  const admin = createClient(',
      '    url,',
      '    process.env.SUPABASE_SERVICE_ROLE_KEY,',
      '  );',
      '  return admin.from("users").delete();',
      '}',
    ].join('\n');

    expect(scanServiceRoleBypass(code, 'lib/admin.ts').findings[0]?.line).toBe(7);
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

  it('accepts a server-only factory module, imported the way Next.js documents it', () => {
    // Corpus case secured-saas-ready: `import 'server-only'` (no `from`) is the
    // canonical form; the authorization check lives at each call site.
    const factory = (serverOnlyImport: string) =>
      [
        serverOnlyImport,
        "import { createClient } from '@supabase/supabase-js';",
        'export function createServiceClient() {',
        '  return createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY);',
        '}',
      ].join('\n');

    expect(
      scanServiceRoleBypass(factory("import 'server-only';"), 'lib/admin.ts').findings,
    ).toEqual([]);
    expect(scanServiceRoleBypass(factory('import "server-only"'), 'lib/admin.ts').findings).toEqual(
      [],
    );
    expect(
      scanServiceRoleBypass(factory("import x from 'server-only';"), 'lib/admin.ts').findings,
    ).toEqual([]);
    // A comment that merely mentions the package is not the import.
    expect(
      scanServiceRoleBypass(factory("// TODO: import 'server-only'"), 'lib/admin.ts').findings,
    ).toHaveLength(1);
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
