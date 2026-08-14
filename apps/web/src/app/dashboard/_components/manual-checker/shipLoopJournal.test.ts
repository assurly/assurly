import { beforeEach, describe, expect, it } from 'vitest';
import {
  cloneProjectFilesForUndo,
  describeAppliedFix,
  describeBatchAppliedFixes,
  popUndoEntry,
  pushUndoEntry,
  resetShipLoopFixIdCounterForTests,
} from './shipLoopJournal';
import type { ShipLoopUndoEntry } from './shipLoopTypes';

beforeEach(() => {
  resetShipLoopFixIdCounterForTests();
});

describe('describeAppliedFix', () => {
  it('describes RLS with consequence-first before and Assurly after copy', () => {
    const fix = describeAppliedFix({
      kind: 'rls',
      ruleId: 'supabase-migration-auth-linked-no-rls',
      detail: 'profiles',
      filePaths: ['schema.sql'],
    });

    expect(fix.label).toBe('Row-Level Security');
    expect(fix.beforeSummary.toLowerCase()).toMatch(/users|data|protection|exposed|locked/);
    expect(fix.afterSummary).toBe('Assurly enabled Row-Level Security on profiles.');
    expect(fix.filePaths).toEqual(['schema.sql']);
  });

  it('describes Stripe webhook signature remediation', () => {
    const fix = describeAppliedFix({
      kind: 'stripe',
      filePaths: ['app/api/webhook/route.ts'],
    });

    expect(fix.afterSummary).toBe('Assurly added Stripe signature verification.');
    expect(fix.beforeSummary.toLowerCase()).toMatch(/fake|payment|stripe|signature/);
  });

  it('describes env documentation remediation', () => {
    const fix = describeAppliedFix({
      kind: 'env',
      detail: 'STRIPE_SECRET_KEY',
      filePaths: ['.env.example'],
    });

    expect(fix.afterSummary).toBe('Assurly documented STRIPE_SECRET_KEY in .env.example.');
  });
});

describe('describeBatchAppliedFixes', () => {
  it('expands a Fix-all batch into one card per logical kind', () => {
    const cards = describeBatchAppliedFixes(
      {
        files: [],
        appliedFindingCount: 6,
        modifiedFileCount: 3,
        envVarsAdded: 2,
        rlsTablesFixed: 1,
        stripeFilesFixed: 1,
        rscImportsFixed: 0,
      },
      ['a.sql', 'route.ts', '.env.example'],
    );

    expect(cards.map((card) => card.kind)).toEqual(['rls', 'stripe', 'env']);
    expect(cards).toHaveLength(3);
  });
});

describe('undo stack helpers', () => {
  it('push and pop restore the previous fixes array reference snapshot', () => {
    const firstFixes = [
      describeAppliedFix({ kind: 'rls', detail: 'profiles', filePaths: ['a.sql'] }),
    ];
    const entry: ShipLoopUndoEntry = {
      mode: 'project',
      files: [{ path: 'a.sql', content: 'create table profiles (id uuid);' }],
      fixes: firstFixes,
    };

    const stacked = pushUndoEntry([], entry);
    expect(stacked).toHaveLength(1);

    const { entry: popped, stack } = popUndoEntry(stacked);
    expect(stack).toHaveLength(0);
    expect(popped?.mode).toBe('project');
    if (popped?.mode === 'project') {
      expect(popped.fixes).toEqual(firstFixes);
      expect(popped.files[0]?.content).toContain('create table profiles');
    }
  });

  it('pop on empty stack returns null', () => {
    expect(popUndoEntry([])).toEqual({ entry: null, stack: [] });
  });

  it('clones project files so undo snapshots are immutable', () => {
    const files = [{ path: 'x.ts', content: 'a' }];
    const cloned = cloneProjectFilesForUndo(files);
    files[0]!.content = 'mutated';
    expect(cloned[0]?.content).toBe('a');
  });
});
