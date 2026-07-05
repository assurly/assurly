import { describe, expect, it } from 'vitest';
import { buildShipGateReport } from './shipGate';
import {
  scanStripeLiveKeyInDev,
  scanStripeMissingSubscriptionEvents,
  scanStripeWebhookIdempotency,
} from './stripeLifecycle';

describe('scanStripeWebhookIdempotency', () => {
  it('warns on webhook handlers without replay protection', () => {
    const code = [
      "import stripe from 'stripe';",
      'export async function POST(req: Request) {',
      '  const event = stripe.webhooks.constructEvent(await req.text(), sig, secret);',
      '  await db.from("billing").update({ active: true });',
      '}',
    ].join('\n');

    const result = scanStripeWebhookIdempotency(code, 'app/api/webhooks/route.ts');
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
