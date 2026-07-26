import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CONSEQUENCE_MAP } from './consequenceMap';

/**
 * Drift guard: every `agent-*` rule id emitted by scanner-core's agent stack
 * must have a curated plain-language consequence. Without this, Phase 2 findings
 * fall back to raw scanner text in ScanFindingCard.
 */
describe('consequence map covers agent-stack rule ids', () => {
  it('has an entry for every agent-* rule id in agentStack.ts', () => {
    const sourcePath = resolve(
      process.cwd(),
      // When vitest runs from the repo root, scanner-core lives here.
      'packages/scanner-core/src/agentStack.ts',
    );
    let source: string;
    try {
      source = readFileSync(sourcePath, 'utf8');
    } catch {
      // Fallback when the web package is the cwd.
      source = readFileSync(
        resolve(process.cwd(), '../../packages/scanner-core/src/agentStack.ts'),
        'utf8',
      );
    }

    const ids = [...source.matchAll(/'(agent-[a-z0-9-]+)'/g)].map((match) => match[1]!);
    const unique = [...new Set(ids)].sort();

    expect(unique.length).toBeGreaterThanOrEqual(8);
    for (const ruleId of unique) {
      expect(CONSEQUENCE_MAP[ruleId], `missing consequence entry for ${ruleId}`).toBeDefined();
      expect(CONSEQUENCE_MAP[ruleId]!.consequence.trim().length).toBeGreaterThan(20);
    }
  });
});
