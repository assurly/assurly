import { describe, expect, it } from 'vitest';
import { buildShipGateReport } from './shipGate';
import {
  scanStripeLiveKeyInDev,
  scanStripeMissingSubscriptionEvents,
  scanStripeWebhookIdempotency,
  scanStripeWebhookIdempotencyForProject,
} from './stripeLifecycle';

const NAKED_WEBHOOK = [
  "import stripe from 'stripe';",
  'export async function POST(req: Request) {',
  '  const event = stripe.webhooks.constructEvent(await req.text(), sig, secret);',
  '  await db.from("billing").update({ active: true });',
  '}',
].join('\n');

describe('scanStripeWebhookIdempotency', () => {
  it('warns on webhook handlers without replay protection', () => {
    const result = scanStripeWebhookIdempotency(NAKED_WEBHOOK, 'app/api/webhooks/route.ts');
    expect(result.findings[0]).toMatchObject({
      ruleId: 'stripe-webhook-no-idempotency',
      severity: 'warning',
      confidence: 'medium',
    });
  });

  it('passes when processed event IDs are persisted', () => {
    const code = [
      "import stripe from 'stripe';",
      'export async function POST(req: Request) {',
      '  const event = stripe.webhooks.constructEvent(await req.text(), sig, secret);',
      '  if (await alreadyProcessed(event.id)) return;',
      '}',
    ].join('\n');

    expect(scanStripeWebhookIdempotency(code, 'app/api/webhooks/route.ts').findings).toEqual([]);
  });
});

describe('scanStripeWebhookIdempotencyForProject', () => {
  it('passes when the handler delegates to a relative helper that persists event.id', () => {
    const findings = scanStripeWebhookIdempotencyForProject([
      {
        file: 'apps/web/src/app/api/stripe/webhook/route.ts',
        content: [
          "import stripe from 'stripe';",
          "import { processStripeEvent } from '../../../../utils/stripeBilling';",
          'export async function POST(req: Request) {',
          '  const event = stripe.webhooks.constructEvent(await req.text(), sig, secret);',
          '  await processStripeEvent(stripe, db, event);',
          '}',
        ].join('\n'),
      },
      {
        file: 'apps/web/src/utils/stripeBilling.ts',
        content: [
          'export async function processStripeEvent(stripe, db, event) {',
          '  return db.processStripeBillingEvent({ eventId: event.id });',
          '}',
        ].join('\n'),
      },
    ]).findings;

    expect(findings).toEqual([]);
  });

  it('still warns when the imported helper has no replay protection', () => {
    const findings = scanStripeWebhookIdempotencyForProject([
      {
        file: 'app/api/webhooks/route.ts',
        content: [
          "import stripe from 'stripe';",
          "import { grantAccess } from '../../billing';",
          'export async function POST(req: Request) {',
          '  const event = stripe.webhooks.constructEvent(await req.text(), sig, secret);',
          '  await grantAccess(event);',
          '}',
        ].join('\n'),
      },
      {
        file: 'app/billing.ts',
        content: 'export async function grantAccess(event) { await db.update({ active: true }); }',
      },
    ]).findings;

    expect(findings).toEqual([
      expect.objectContaining({
        ruleId: 'stripe-webhook-no-idempotency',
        file: 'app/api/webhooks/route.ts',
      }),
    ]);
  });

  it('flags only the unprotected handler when a sibling webhook is covered', () => {
    const findings = scanStripeWebhookIdempotencyForProject([
      {
        file: 'app/api/webhooks/billing/route.ts',
        content: [
          "import stripe from 'stripe';",
          "import { processStripeEvent } from '../../../lib/stripeBilling';",
          'export async function POST(req: Request) {',
          '  const event = stripe.webhooks.constructEvent(await req.text(), sig, secret);',
          '  await processStripeEvent(event);',
          '}',
        ].join('\n'),
      },
      {
        file: 'app/lib/stripeBilling.ts',
        content: 'export async function processStripeEvent(event) { return event.id; }',
      },
      {
        file: 'app/api/webhooks/legacy/route.ts',
        content: NAKED_WEBHOOK,
      },
    ]).findings;

    expect(findings.map((finding) => finding.file)).toEqual(['app/api/webhooks/legacy/route.ts']);
  });

  it('does not follow the stripe package even when that file is in the scan set', () => {
    const findings = scanStripeWebhookIdempotencyForProject([
      {
        file: 'app/api/webhooks/route.ts',
        content: NAKED_WEBHOOK,
      },
      {
        file: 'node_modules/stripe/index.js',
        content: 'export const alreadyProcessed = (id) => id; event.id; idempotency;',
      },
    ]).findings;

    expect(findings).toEqual([
      expect.objectContaining({
        ruleId: 'stripe-webhook-no-idempotency',
        file: 'app/api/webhooks/route.ts',
      }),
    ]);
  });

  it('does not treat an unimported ledger file as coverage for a naked webhook', () => {
    const findings = scanStripeWebhookIdempotencyForProject([
      {
        file: 'app/api/webhooks/route.ts',
        content: NAKED_WEBHOOK,
      },
      {
        file: 'utils/ledger.ts',
        content: 'export const COLUMN = "stripe_event_id";',
      },
    ]).findings;

    expect(findings).toEqual([
      expect.objectContaining({
        ruleId: 'stripe-webhook-no-idempotency',
        file: 'app/api/webhooks/route.ts',
      }),
    ]);
  });

  it('follows a second relative hop when the helper re-exports ledger code', () => {
    const findings = scanStripeWebhookIdempotencyForProject([
      {
        file: 'app/api/webhooks/route.ts',
        content: [
          "import stripe from 'stripe';",
          "import { processStripeEvent } from '../../billing';",
          'export async function POST(req: Request) {',
          '  const event = stripe.webhooks.constructEvent(await req.text(), sig, secret);',
          '  await processStripeEvent(event);',
          '}',
        ].join('\n'),
      },
      {
        file: 'app/billing.ts',
        content: "export { processStripeEvent } from './ledger';",
      },
      {
        file: 'app/ledger.ts',
        content: 'export async function processStripeEvent(event) { return event.id; }',
      },
    ]).findings;

    expect(findings).toEqual([]);
  });
});

describe('scanStripeLiveKeyInDev', () => {
  it('flags sk_live_ keys in dev/test env files with a masked message', () => {
    const env = 'STRIPE_SECRET_KEY=sk_live_51NzYABCDEF1234567890abcdefghijklmnop';
    const result = scanStripeLiveKeyInDev(env, '.env.development');
    expect(result.findings[0]).toMatchObject({
      ruleId: 'stripe-live-key-in-dev',
      severity: 'error',
      confidence: 'high',
    });
    expect(result.findings[0]?.message).toContain('sk_live_51');
    expect(result.findings[0]?.message).not.toContain('abcdefghijklmnop');
  });

  it('does not flag test keys in dev env files', () => {
    const env = 'STRIPE_SECRET_KEY=sk_test_51NzYABCDEF1234567890abcdefghijklmnop';
    expect(scanStripeLiveKeyInDev(env, '.env.development').findings).toEqual([]);
  });
});

describe('scanStripeMissingSubscriptionEvents', () => {
  it('warns when a subscription webhook lacks lifecycle handlers', () => {
    const code = [
      "import stripe from 'stripe';",
      'export async function POST(req: Request) {',
      '  const event = stripe.webhooks.constructEvent(await req.text(), sig, secret);',
      "  // grants access for new subscription checkouts (mode: 'subscription')",
      "  if (event.type === 'checkout.session.completed') {",
      '    await grantAccess(event);',
      '  }',
      '}',
    ].join('\n');

    const result = scanStripeMissingSubscriptionEvents(code, 'app/api/stripe/webhook/route.ts');
    expect(result.findings[0]).toMatchObject({
      ruleId: 'stripe-missing-subscription-events',
      severity: 'warning',
      confidence: 'low',
    });

    const report = buildShipGateReport(result.findings);
    expect(report.blockers).toHaveLength(0);
  });

  it('does not fire on env declarations or unrelated files that merely mention subscriptions', () => {
    // Regression: these are not webhook handlers and must not fire.
    const envFile = "export const env = { STRIPE_PRICE_PRO: '', STRIPE_SECRET_KEY: '' };";
    const extension =
      '// manages subscriptions in the VS Code extension\nexport function activate() {}';

    expect(scanStripeMissingSubscriptionEvents(envFile, 'utils/env.ts').findings).toEqual([]);
    expect(
      scanStripeMissingSubscriptionEvents(extension, 'packages/vscode-extension/src/extension.ts')
        .findings,
    ).toEqual([]);
  });

  it('passes when subscription webhook events are handled', () => {
    const code = [
      "import stripe from 'stripe';",
      'export async function POST() {',
      "  if (event.type === 'customer.subscription.deleted') {",
      '    await revokeAccess(event);',
      '  }',
      '}',
    ].join('\n');

    expect(scanStripeMissingSubscriptionEvents(code, 'app/api/webhooks/route.ts').findings).toEqual(
      [],
    );
  });
});
