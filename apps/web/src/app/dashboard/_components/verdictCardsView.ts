import type { TargetCard } from '../../../utils/clientApi';

export type AppsKindFilter = 'all' | 'repos' | 'urls';
export type AppsVerdictFilter = 'all' | 'blocked' | 'review' | 'ready' | 'unknown';
export type AppsSort = 'urgency' | 'score-asc' | 'score-desc' | 'name' | 'checked';
export type AppsDensity = 'comfortable' | 'compact';

export interface VerdictCardsViewPrefs {
  density: AppsDensity;
  sort: AppsSort;
  kindFilter: AppsKindFilter;
  verdictFilter: AppsVerdictFilter;
}

export const VERDICT_CARDS_PREFS_KEY = 'assurly.yourApps.view';

const VERDICT_URGENCY: Record<TargetCard['verdict'], number> = {
  blocked: 0,
  review: 1,
  ready: 2,
  unknown: 3,
};

const DEFAULT_PREFS: VerdictCardsViewPrefs = {
  density: 'comfortable',
  sort: 'urgency',
  kindFilter: 'all',
  verdictFilter: 'all',
};

function isAppsDensity(value: unknown): value is AppsDensity {
  return value === 'comfortable' || value === 'compact';
}

function isAppsSort(value: unknown): value is AppsSort {
  return (
    value === 'urgency' ||
    value === 'score-asc' ||
    value === 'score-desc' ||
    value === 'name' ||
    value === 'checked'
  );
}

function isAppsKindFilter(value: unknown): value is AppsKindFilter {
  return value === 'all' || value === 'repos' || value === 'urls';
}

function isAppsVerdictFilter(value: unknown): value is AppsVerdictFilter {
  return (
    value === 'all' ||
    value === 'blocked' ||
    value === 'review' ||
    value === 'ready' ||
    value === 'unknown'
  );
}

export function readVerdictCardsPrefs(): VerdictCardsViewPrefs {
  if (typeof window === 'undefined') return { ...DEFAULT_PREFS };
  try {
    const raw = window.localStorage.getItem(VERDICT_CARDS_PREFS_KEY);
    if (!raw) return { ...DEFAULT_PREFS };
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return { ...DEFAULT_PREFS };
    const record = parsed as Record<string, unknown>;
    return {
      density: isAppsDensity(record.density) ? record.density : DEFAULT_PREFS.density,
      sort: isAppsSort(record.sort) ? record.sort : DEFAULT_PREFS.sort,
      kindFilter: isAppsKindFilter(record.kindFilter)
        ? record.kindFilter
        : DEFAULT_PREFS.kindFilter,
      verdictFilter: isAppsVerdictFilter(record.verdictFilter)
        ? record.verdictFilter
        : DEFAULT_PREFS.verdictFilter,
    };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

export function writeVerdictCardsPrefs(prefs: VerdictCardsViewPrefs): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(VERDICT_CARDS_PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // Ignore quota / private-mode failures — prefs are non-critical.
  }
}

export function filterCardsByKind(cards: TargetCard[], filter: AppsKindFilter): TargetCard[] {
  switch (filter) {
    case 'all':
      return cards;
    case 'repos':
      return cards.filter((card) => card.kind === 'repo');
    case 'urls':
      return cards.filter((card) => card.kind === 'url');
    default: {
      const neverFilter: never = filter;
      return neverFilter;
    }
  }
}

/** Unscanned means never scanned AND still browser-scannable (not CLI-only / invalid). */
export function isBrowserUnscannedCard(card: TargetCard): boolean {
  return card.verdict === 'unknown' && (card.scanCapability ?? 'browser') === 'browser';
}

/**
 * Honest coverage label for cards — Instant (browser) vs Full (CLI) vs incomplete.
 * Capability describes browser eligibility; a cli_only repo can still show a Full Gate score.
 */
export function coverageLabelForCard(card: TargetCard): string | null {
  if (card.kind !== 'repo') return null;
  if (card.scanCapability === 'cli_only') {
    return card.shipScore === null ? 'Full Gate · CLI' : 'Full Gate';
  }
  if (card.scanCapability === 'invalid') return null;
  const topKey = card.topIssue?.key ?? '';
  if (
    topKey.includes('scan-completeness') ||
    card.topIssue?.label?.toLowerCase().includes('incomplete')
  ) {
    return 'Instant · incomplete';
  }
  if (card.verdict === 'unknown') return null;
  return 'Instant Gate';
}

/** Canonical Full Gate command shown on cli_only cards (copyable). */
export function fullGateCliCommand(repoName?: string | null): string {
  const repo = typeof repoName === 'string' && repoName.includes('/') ? repoName : 'owner/repo';
  return `ASSURLY_API_KEY=ask_… npx assurly scan --submit --repo ${repo}`;
}

export function filterCardsByVerdict(cards: TargetCard[], filter: AppsVerdictFilter): TargetCard[] {
  if (filter === 'all') return cards;
  if (filter === 'unknown') {
    return cards.filter(isBrowserUnscannedCard);
  }
  return cards.filter((card) => card.verdict === filter);
}

function compareByName(a: TargetCard, b: TargetCard): number {
  return a.displayName.localeCompare(b.displayName, undefined, { sensitivity: 'base' });
}

function scoreValue(card: TargetCard, missing: number): number {
  return card.shipScore === null ? missing : card.shipScore;
}

function checkedValue(card: TargetCard): number {
  if (!card.lastCheckedAt) return 0;
  const time = new Date(card.lastCheckedAt).getTime();
  return Number.isNaN(time) ? 0 : time;
}

export function sortVerdictCards(cards: TargetCard[], sort: AppsSort): TargetCard[] {
  const sorted = [...cards];
  sorted.sort((a, b) => {
    switch (sort) {
      case 'urgency': {
        const urgency = VERDICT_URGENCY[a.verdict] - VERDICT_URGENCY[b.verdict];
        if (urgency !== 0) return urgency;
        // Within the same verdict, lower scores first (more concerning).
        const score = scoreValue(a, 101) - scoreValue(b, 101);
        if (score !== 0) return score;
        return compareByName(a, b);
      }
      case 'score-asc': {
        const score = scoreValue(a, 101) - scoreValue(b, 101);
        if (score !== 0) return score;
        return compareByName(a, b);
      }
      case 'score-desc': {
        const score = scoreValue(b, -1) - scoreValue(a, -1);
        if (score !== 0) return score;
        return compareByName(a, b);
      }
      case 'name':
        return compareByName(a, b);
      case 'checked': {
        const checked = checkedValue(b) - checkedValue(a);
        if (checked !== 0) return checked;
        return compareByName(a, b);
      }
      default: {
        const neverSort: never = sort;
        return neverSort;
      }
    }
  });
  return sorted;
}

/**
 * Guardian on every connected repo is the default — repeating the chip causes
 * warning fatigue. Surface it only when the user explicitly opted a URL into
 * Continuous Guardian (or when monitoring is pending verification).
 */
export function shouldShowGuardianChip(card: TargetCard): boolean {
  if (card.kind !== 'url') return false;
  return card.guardianEnabled;
}

export function countByVerdict(
  cards: TargetCard[],
): Record<Exclude<AppsVerdictFilter, 'all'>, number> {
  return {
    blocked: cards.filter((card) => card.verdict === 'blocked').length,
    review: cards.filter((card) => card.verdict === 'review').length,
    ready: cards.filter((card) => card.verdict === 'ready').length,
    unknown: cards.filter(isBrowserUnscannedCard).length,
  };
}
