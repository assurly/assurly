/**
 * Whether a verdict still describes the app. One rule for every surface that
 * shows a verdict — dashboard card, README badge, public report — so a green
 * badge never outlives the card that says it is out of date.
 *
 * A verdict is about one commit at one moment. It stops describing the app
 * when newer code exists (`code_changed`, known from push events) or, when we
 * cannot see commits, after enough time that it probably does (`old`).
 */

/** After this many days a verdict is treated as out of date. */
export const STALE_VERDICT_DAYS = 7;

export type VerdictFreshnessStatus = 'current' | 'old' | 'code_changed' | 'unknown';

export interface VerdictFreshness {
  status: VerdictFreshnessStatus;
  /** Whole days since the check, rounded like "Checked 9d ago"; null if never. */
  daysOld: number | null;
}

export interface VerdictFreshnessInput {
  checkedAt: string | null | undefined;
  /** The commit the verdict was computed from. */
  checkedCommitSha?: string | null;
  /** The newest commit seen on the branch the app ships from. */
  headCommitSha?: string | null;
}

const COMMIT_SHA = /^[0-9a-f]{7,64}$/i;

/** Whole days since `iso`, rounded exactly as the "Checked 9d ago" line rounds. */
export function daysSinceCheck(
  iso: string | null | undefined,
  now: number = Date.now(),
): number | null {
  if (!iso) return null;
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return null;
  const minutes = Math.round(Math.max(0, Math.round((now - then) / 1000)) / 60);
  return Math.round(Math.round(minutes / 60) / 24);
}

/**
 * True when both commits are real SHAs and differ. Placeholders such as
 * "unknown", "cli" or "local" say nothing about the code, so they never
 * count as a change.
 */
export function codeChangedSinceCheck(
  checkedCommitSha: string | null | undefined,
  headCommitSha: string | null | undefined,
): boolean {
  if (!checkedCommitSha || !headCommitSha) return false;
  if (!COMMIT_SHA.test(checkedCommitSha) || !COMMIT_SHA.test(headCommitSha)) return false;
  const checked = checkedCommitSha.toLowerCase();
  const head = headCommitSha.toLowerCase();
  // A short SHA from an older record still matches its full form.
  return !(head.startsWith(checked) || checked.startsWith(head));
}

export function verdictFreshness(
  input: VerdictFreshnessInput,
  now: number = Date.now(),
): VerdictFreshness {
  const daysOld = daysSinceCheck(input.checkedAt, now);
  if (daysOld === null) return { status: 'unknown', daysOld: null };
  if (codeChangedSinceCheck(input.checkedCommitSha, input.headCommitSha)) {
    return { status: 'code_changed', daysOld };
  }
  const ageMs = now - new Date(input.checkedAt as string).getTime();
  if (ageMs >= STALE_VERDICT_DAYS * 24 * 60 * 60 * 1000) return { status: 'old', daysOld };
  return { status: 'current', daysOld };
}

/** Plain wording of why a verdict is out of date, or null while it is current. */
export function freshnessNote(freshness: VerdictFreshness): string | null {
  switch (freshness.status) {
    case 'code_changed':
      return 'The code has changed since this check.';
    case 'old':
      return `This check is ${freshness.daysOld} ${freshness.daysOld === 1 ? 'day' : 'days'} old; the code may have changed since.`;
    case 'current':
    case 'unknown':
      return null;
    default: {
      const neverStatus: never = freshness.status;
      return neverStatus;
    }
  }
}
