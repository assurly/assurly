import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildShipGateReport,
  isShipGateBlocked,
  runDeeperStackScans,
  type SourceInput,
} from './index';

const REPO_ROOT = path.resolve(__dirname, '../../..');

function collectProjectSources(projectDir: string): SourceInput[] {
  const sources: SourceInput[] = [];
  const stack: string[] = [projectDir];

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) continue;
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === '.git') continue;
        stack.push(fullPath);
        continue;
      }

      const relative = path.relative(projectDir, fullPath).replace(/\\/g, '/');
      if (
        relative.endsWith('.sql') ||
        /\.(?:js|ts|jsx|tsx)$/.test(relative) ||
        /(?:^|[/\\])\.env(?:\.(?:local|development|dev|test|staging))?$/.test(relative)
      ) {
        sources.push({ file: relative, content: fs.readFileSync(fullPath, 'utf8') });
      }
    }
  }

  return sources;
}

describe('Phase 3 integration fixtures', () => {
  it('broken-project yields expected deeper-stack blockers', () => {
    const sources = collectProjectSources(path.join(REPO_ROOT, 'test-projects/broken-project'));
    const findings = runDeeperStackScans(sources).findings;
    const report = buildShipGateReport(findings);

    expect(findings.some((finding) => finding.ruleId === 'vercel-edge-node-mismatch')).toBe(true);
    expect(isShipGateBlocked(report)).toBe(true);
    expect(report.blockers.some((group) => group.id === 'edge:runtime')).toBe(true);
  });

  it('clean-project yields no deeper-stack blockers', () => {
    const sources = collectProjectSources(path.join(REPO_ROOT, 'test-projects/clean-project'));
    const findings = runDeeperStackScans(sources).findings;
    const report = buildShipGateReport(findings);

    expect(report.blockers).toHaveLength(0);
    expect(
      findings.some((finding) => finding.confidence === 'high' && finding.severity === 'error'),
    ).toBe(false);
  });

  it('does not flag a Stripe webhook that delegates idempotency to a helper', () => {
    const findings = runDeeperStackScans([
      {
        file: 'apps/web/src/app/api/stripe/webhook/route.ts',
        content: [
          "import Stripe from 'stripe';",
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

    expect(findings.some((finding) => finding.ruleId === 'stripe-webhook-no-idempotency')).toBe(
      false,
    );
  });

  it('does not flag Assurly own Stripe webhook that delegates to the billing ledger', () => {
    const webhookPath = 'apps/web/src/app/api/stripe/webhook/route.ts';
    const billingPath = 'apps/web/src/utils/stripeBilling.ts';
    const findings = runDeeperStackScans([
      {
        file: webhookPath,
        content: fs.readFileSync(path.join(REPO_ROOT, webhookPath), 'utf8'),
      },
      {
        file: billingPath,
        content: fs.readFileSync(path.join(REPO_ROOT, billingPath), 'utf8'),
      },
    ]).findings;

    expect(findings.some((finding) => finding.ruleId === 'stripe-webhook-no-idempotency')).toBe(
      false,
    );
  });
});
