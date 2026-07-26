import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { allRules } from './rules';

/**
 * The CLI README is the npm package page. It once said "Eleven rule areas"
 * while `allRules` grew — nothing failed, because nothing was checking.
 * Derive count and area coverage from `allRules` so drift fails the build.
 */
const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');

const SPELLED_COUNTS: Record<number, string> = {
  11: 'Eleven',
  12: 'Twelve',
  13: 'Thirteen',
  14: 'Fourteen',
};

/** Human labels used in the README table — keyed by rule id. */
const RULE_AREA_LABELS: Record<string, string> = {
  'env-vars-validator': 'Environment variables',
  'supabase-security-checks': 'Supabase security',
  'stripe-integration-security': 'Stripe integration',
  'vercel-edge-compatibility': 'Vercel edge compatibility',
  'github-actions-integration': 'CI integration',
  'typescript-strict-mode': 'TypeScript strictness',
  'database-connection-pooling': 'Database connection pooling',
  'rsc-data-leaks': 'React Server Components',
  'cold-start-optimization': 'Cold start',
  'database-migration-safety': 'SQL / migration safety',
  'deeper-stack-rules': 'Deeper stack',
  'agent-stack': 'Agent stack',
};

describe('CLI README', () => {
  it('states the correct rule-area count derived from allRules', () => {
    const expected = SPELLED_COUNTS[allRules.length];
    expect(expected, `Add a spelled count for ${allRules.length} rules`).toBeDefined();
    expect(readme).toContain(`${expected} rule areas`);
  });

  it('documents every registered rule area', () => {
    for (const rule of allRules) {
      const label = RULE_AREA_LABELS[rule.id];
      expect(label, `Missing README label mapping for rule id ${rule.id}`).toBeDefined();
      expect(readme, `README missing area "${label}" for ${rule.id}`).toContain(label as string);
    }
  });
});
