import type { DbAdapter, ProbeEvidenceInput } from './dbAdapter';
import type { ProbeEvidence } from './runtimeScanner';

export interface ReplaceProbeEvidenceIds {
  organizationId: string;
  targetId: string;
}

/**
 * A url target's evidence rows always describe its latest probe run: delete
 * first, then insert. An empty run therefore clears the previous proof.
 * Best-effort — never throws.
 */
export async function replaceProbeEvidenceForTarget(
  db: Pick<DbAdapter, 'deleteProbeEvidenceForTarget' | 'insertProbeEvidence'>,
  ids: ReplaceProbeEvidenceIds,
  evidence: readonly ProbeEvidence[],
): Promise<void> {
  try {
    await db.deleteProbeEvidenceForTarget(ids.targetId);
    if (evidence.length === 0) return;
    const rows: ProbeEvidenceInput[] = evidence.map((item) => ({
      organizationId: ids.organizationId,
      targetId: ids.targetId,
      scanId: null,
      findingRuleId: item.findingRuleId,
      kind: item.kind,
      summary: item.summary,
      redactedSample: item.redactedSample ?? null,
    }));
    await db.insertProbeEvidence(rows);
  } catch (error) {
    console.warn('[Assurly] failed to replace probe evidence:', (error as Error).message);
  }
}
