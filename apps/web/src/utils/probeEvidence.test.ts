import { afterEach, describe, expect, it, vi } from 'vitest';
import { replaceProbeEvidenceForTarget } from './probeEvidence';
import type { ProbeEvidence } from './runtimeScanner';

function rlsEvidence(): ProbeEvidence {
  return {
    findingRuleId: 'runtime-supabase-rls-open',
    kind: 'rls_rows',
    summary: 'We read 5 rows from your `customers` table using only the public key.',
    redactedSample: { table: 'customers', rowCount: 5 },
  };
}

describe('replaceProbeEvidenceForTarget', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('deletes the target rows then inserts the new run', async () => {
    const order: string[] = [];
    const db = {
      deleteProbeEvidenceForTarget: vi.fn(async () => {
        order.push('delete');
      }),
      insertProbeEvidence: vi.fn(async () => {
        order.push('insert');
      }),
    };

    await replaceProbeEvidenceForTarget(db, { organizationId: 'org-1', targetId: 'target-1' }, [
      rlsEvidence(),
    ]);

    expect(order).toEqual(['delete', 'insert']);
    expect(db.deleteProbeEvidenceForTarget).toHaveBeenCalledWith('target-1');
    expect(db.insertProbeEvidence).toHaveBeenCalledWith([
      expect.objectContaining({
        organizationId: 'org-1',
        targetId: 'target-1',
        scanId: null,
        findingRuleId: 'runtime-supabase-rls-open',
        kind: 'rls_rows',
      }),
    ]);
  });

  it('deletes only when the new run produced no evidence', async () => {
    const db = {
      deleteProbeEvidenceForTarget: vi.fn().mockResolvedValue(undefined),
      insertProbeEvidence: vi.fn().mockResolvedValue(undefined),
    };

    await replaceProbeEvidenceForTarget(db, { organizationId: 'org-1', targetId: 'target-1' }, []);

    expect(db.deleteProbeEvidenceForTarget).toHaveBeenCalledWith('target-1');
    expect(db.insertProbeEvidence).not.toHaveBeenCalled();
  });

  it('never throws when the adapter fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const db = {
      deleteProbeEvidenceForTarget: vi.fn().mockRejectedValue(new Error('db down')),
      insertProbeEvidence: vi.fn(),
    };

    await expect(
      replaceProbeEvidenceForTarget(db, { organizationId: 'org-1', targetId: 'target-1' }, [
        rlsEvidence(),
      ]),
    ).resolves.toBeUndefined();
    expect(db.insertProbeEvidence).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalled();
  });
});
