import type { DbAdapter, Repository, ScanFinding } from './dbAdapter';
import { sendRegressionAlert } from './notify';

function regressionKey(
  finding: Pick<ScanFinding, 'rule_id' | 'file_path' | 'line_number'>,
): string {
  return `${finding.rule_id}|${finding.file_path}|${finding.line_number ?? 0}`;
}

/** Returns findings in `current` that were not present in `previous` (pure, no I/O). */
export function detectRegressions(previous: ScanFinding[], current: ScanFinding[]): ScanFinding[] {
  const previousKeys = new Set(previous.map(regressionKey));
  return current.filter((finding) => !previousKeys.has(regressionKey(finding)));
}

/**
 * A finding blocks the Ship Gate only when it is error-severity AND high
 * confidence — mirroring scanner-core's `isBlockerFinding` (a missing confidence
 * is treated as 'high' for legacy rows). Error + medium/low is a review item, so
 * it must NOT trigger a "new blocker" alert.
 */
function isBlockerFinding(finding: ScanFinding): boolean {
  return finding.severity === 'error' && (finding.confidence ?? 'high') === 'high';
}

export function detectNewBlockers(previous: ScanFinding[], current: ScanFinding[]): ScanFinding[] {
  return detectRegressions(previous, current).filter(isBlockerFinding);
}

export async function notifyIfRegressionBlockers(
  db: DbAdapter,
  repository: Repository,
  previousFindings: ScanFinding[],
  currentFindings: ScanFinding[],
): Promise<void> {
  const newBlockers = detectNewBlockers(previousFindings, currentFindings);
  if (newBlockers.length === 0) return;

  const recipients = await db.getOrganizationAdminEmails(repository.organization_id);
  if (recipients.length === 0) return;

  await sendRegressionAlert(recipients, { name: repository.name }, newBlockers);
}
