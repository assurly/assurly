import { describe, expect, it } from 'vitest';
import type { WebFinding } from '../../../../utils/browserScanner';
import { describeAppliedFix, resetShipLoopFixIdCounterForTests } from './shipLoopJournal';
import { buildManualCheckerHandoffPrompt } from './shipHandoff';

describe('buildManualCheckerHandoffPrompt', () => {
  it('includes READY TO SHIP goal, applied fixes, and remaining finding text', () => {
    resetShipLoopFixIdCounterForTests();
    const applied = [
      describeAppliedFix({
        kind: 'stripe',
        filePaths: ['route.ts'],
      }),
    ];
    const remaining: WebFinding[] = [
      {
        ruleId: 'undocumented-env',
        severity: 'warning',
        file: 'lib/config.ts',
        line: 2,
        message:
          "Environment variable 'process.env.STRIPE_SECRET_KEY' is used but not documented in '.env.example'.",
        suggestion: 'Add STRIPE_SECRET_KEY= to .env.example.',
      },
    ];

    const prompt = buildManualCheckerHandoffPrompt({
      remainingFindings: remaining,
      appliedFixes: applied,
      mode: 'project',
    });

    expect(prompt).toContain('Assurly Manual Checker — agent handoff');
    expect(prompt).toContain('Goal: READY TO SHIP (0 blockers)');
    expect(prompt).toContain('Re-scan in Assurly Manual Checker after edits');
    expect(prompt).toContain('Already fixed locally by Assurly:');
    expect(prompt).toContain('Assurly added Stripe signature verification.');
    expect(prompt).toContain('Remaining issues to fix:');
    expect(prompt).toContain('STRIPE_SECRET_KEY');
    expect(prompt).toContain('lib/config.ts');
  });

  it('masks secrets in remaining findings via buildAiFixPrompt', () => {
    const remaining: WebFinding[] = [
      {
        ruleId: 'stripe-secret-leak',
        severity: 'error',
        file: '.env',
        line: 1,
        message:
          'CRITICAL KEY LEAK: Hardcoded Stripe secret key found (sk_live_abcdefghij1234567890).',
      },
    ];

    const prompt = buildManualCheckerHandoffPrompt({
      remainingFindings: remaining,
      appliedFixes: [],
      mode: 'snippet',
    });

    expect(prompt).toContain('[REDACTED_SECRET]');
    expect(prompt).not.toContain('sk_live_abcdefghij1234567890');
  });

  it('handles empty remaining findings safely', () => {
    const prompt = buildManualCheckerHandoffPrompt({
      remainingFindings: [],
      appliedFixes: [],
      mode: 'snippet',
    });

    expect(prompt).toContain('No remaining issues');
    expect(prompt).toContain('Already fixed locally by Assurly:');
    expect(prompt).toContain('(none yet)');
  });
});
