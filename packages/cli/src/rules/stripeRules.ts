import * as fs from 'fs';
import * as path from 'path';
import { scanStripeWebhook } from '@shipready/scanner-core';
import { Rule, ProjectContext, Finding } from '../types';

const secretKeyPattern = /sk_(?:live|test)_[a-zA-Z0-9]{24,}/g;

export const stripeRules: Rule = {
  id: 'stripe-integration-security',
  name: 'Stripe Security Validation',
  description: 'Verifies Stripe webhook signatures and detects leaked Stripe secret keys.',
  severity: 'error',

  async run(context: ProjectContext): Promise<Finding[]> {
    if (context.detectedStack.payments !== 'stripe') return [];
    const findings: Finding[] = [];
    const codeFiles = context.files.filter((file) => /\.(?:js|ts|jsx|tsx)$/.test(file));

    for (const file of codeFiles) {
      const content = fs.readFileSync(path.join(context.projectPath, file), 'utf8');
      findings.push(...scanStripeWebhook(content, file).findings);
    }

    const textFiles = context.files.filter(
      (file) => /\.(?:js|ts|jsx|tsx|json|yml|yaml|md|txt)$/.test(file) && !file.includes('.env'),
    );
    for (const file of textFiles) {
      const lines = fs.readFileSync(path.join(context.projectPath, file), 'utf8').split(/\r?\n/);
      lines.forEach((line, index) => {
        secretKeyPattern.lastIndex = 0;
        for (const match of line.matchAll(secretKeyPattern)) {
          findings.push({
            ruleId: this.id,
            severity: 'error',
            file,
            line: index + 1,
            message: `CRITICAL KEY LEAK: Hardcoded Stripe secret key found in source file (${match[0].slice(0, 7)}...).`,
            suggestion: 'Rotate the key and replace it with process.env.STRIPE_SECRET_KEY.',
          });
        }
      });
    }

    for (const file of context.files.filter((candidate) => candidate.startsWith('.env'))) {
      const content = fs.readFileSync(path.join(context.projectPath, file), 'utf8');
      if (/NEXT_PUBLIC_STRIPE_(?:SECRET_KEY|SK)/.test(content)) {
        findings.push({
          ruleId: this.id,
          severity: 'error',
          file,
          message: 'Stripe secret key uses a NEXT_PUBLIC_ prefix and would be exposed to browsers.',
          suggestion: 'Rename it to STRIPE_SECRET_KEY and use it only in server-side code.',
        });
      }
    }
    return findings;
  },
};
