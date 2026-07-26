import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CONSEQUENCE_MAP } from './consequenceMap';

/**
 * Drift guard: every `supply-*` rule id emitted by scanner-core's install-time
 * trust audit must have a curated plain-language consequence. Without this,
 * findings fall back to raw scanner text in ScanFindingCard.
 */
describe('consequence map covers supply-chain rule ids', () => {
  it('has an entry for every supply-* rule id in supplyChain.ts', () => {
    const sourcePath = resolve(process.cwd(), 'packages/scanner-core/src/supplyChain.ts');
    let source: string;
    try {
      source = readFileSync(sourcePath, 'utf8');
    } catch {
      source = readFileSync(
        resolve(process.cwd(), '../../packages/scanner-core/src/supplyChain.ts'),
        'utf8',
      );
    }

    const ids = [...source.matchAll(/'(supply-[a-z0-9-]+)'/g)].map((match) => match[1]!);
    const unique = [...new Set(ids)].sort();

    expect(unique.length).toBeGreaterThanOrEqual(7);
    for (const ruleId of unique) {
      expect(CONSEQUENCE_MAP[ruleId], `missing consequence entry for ${ruleId}`).toBeDefined();
      expect(CONSEQUENCE_MAP[ruleId]!.consequence.trim().length).toBeGreaterThan(20);
    }
  });
});
