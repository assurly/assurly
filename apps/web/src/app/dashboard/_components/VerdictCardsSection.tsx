'use client';

import { useEffect, useMemo, useState, type ChangeEvent, type ReactElement } from 'react';
import type { TargetCard } from '../../../utils/clientApi';
import { useAccessibleMenu } from '../../../hooks/useAccessibleMenu';
import { VerdictCard } from './VerdictCard';
import {
  countByVerdict,
  filterCardsByKind,
  filterCardsByVerdict,
  readVerdictCardsPrefs,
  sortVerdictCards,
  writeVerdictCardsPrefs,
  type AppsDensity,
  type AppsKindFilter,
  type AppsSort,
  type AppsVerdictFilter,
} from './verdictCardsView';

export type AppsFilter = AppsKindFilter;

export interface VerdictCardsSectionProps {
  /** Open the app's detail (selects the repo in the existing scan flow). */
  onOpenRepo: (repositoryId: string) => void;
  /** Remove a guarded URL app from Your apps. */
  onRemoveUrl?: (targetId: string) => void | Promise<void>;
  /** Remove a connected repository from Your apps. */
  onRemoveRepo?: (repositoryId: string) => void | Promise<void>;
  /** Refresh a stale / never-scanned app from the card CTA. */
  onRescan?: (card: TargetCard) => void | Promise<void>;
  /** `null` while the first load is in flight; otherwise the current cards. */
  cards: TargetCard[] | null;
  error: string | null;
  /** Target id currently being removed (disables its Remove control). */
  removingTargetId?: string | null;
  /** Repository id currently being removed. */
  removingRepositoryId?: string | null;
  /** Target / repo key currently being rescanned (shows Scanning… on that card). */
  rescanningTargetId?: string | null;
  /** Disable every Rescan CTA while a scan/reprobe is already running. */
  rescanBlocked?: boolean;
}

function handleCardOpen(card: TargetCard, onOpenRepo: (repositoryId: string) => void): void {
  if (card.kind === 'repo' && card.repositoryId) {
    onOpenRepo(card.repositoryId);
  }
}

/**
 * The dashboard's primary surface (Phase 1): one always-current verdict per app.
 * Data is owned by the parent so `/api/targets` is fetched once and shared with
 * canary / guardian target lookup.
 *
 * Listed apps are connected repos + explicitly guarded URLs. One-off URL
 * probes never appear here.
 */
function rescanBusyKey(card: TargetCard): string {
  return card.kind === 'repo' && card.repositoryId ? card.repositoryId : card.id;
}

const SORT_OPTIONS: { value: AppsSort; label: string }[] = [
  { value: 'urgency', label: 'Blockers first' },
  { value: 'score-asc', label: 'Score: low → high' },
  { value: 'score-desc', label: 'Score: high → low' },
  { value: 'name', label: 'Name' },
  { value: 'checked', label: 'Recently checked' },
];

export function VerdictCardsSection({
  onOpenRepo,
  onRemoveUrl,
  onRemoveRepo,
  onRescan,
  cards = null,
  error = null,
  removingTargetId = null,
  removingRepositoryId = null,
  rescanningTargetId = null,
  rescanBlocked = false,
}: VerdictCardsSectionProps): ReactElement {
  const [kindFilter, setKindFilter] = useState<AppsKindFilter>('all');
  const [verdictFilter, setVerdictFilter] = useState<AppsVerdictFilter>('all');
  const [sort, setSort] = useState<AppsSort>('urgency');
  const [density, setDensity] = useState<AppsDensity>('comfortable');
  const [prefsReady, setPrefsReady] = useState(false);
  const [confirmCard, setConfirmCard] = useState<TargetCard | null>(null);
  const { menuRef: dialogRef, rememberTrigger } = useAccessibleMenu<HTMLDivElement>({
    open: confirmCard !== null,
    onClose: () => setConfirmCard(null),
  });

  useEffect(() => {
    const prefs = readVerdictCardsPrefs();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- hydrate view prefs after mount to avoid SSR mismatch
    setSort(prefs.sort);
    setDensity(prefs.density);
    setKindFilter(prefs.kindFilter);
    setVerdictFilter(prefs.verdictFilter);
    setPrefsReady(true);
  }, []);

  useEffect(() => {
    if (!prefsReady) return;
    writeVerdictCardsPrefs({ sort, density, kindFilter, verdictFilter });
  }, [prefsReady, sort, density, kindFilter, verdictFilter]);

  const kindScopedCards = useMemo(
    () => (cards === null ? null : filterCardsByKind(cards, kindFilter)),
    [cards, kindFilter],
  );

  const visibleCards = useMemo(() => {
    if (kindScopedCards === null) return null;
    return sortVerdictCards(filterCardsByVerdict(kindScopedCards, verdictFilter), sort);
  }, [kindScopedCards, verdictFilter, sort]);

  const blockedCount = kindScopedCards?.filter((c) => c.verdict === 'blocked').length ?? 0;
  const repoCount = cards?.filter((c) => c.kind === 'repo').length ?? 0;
  const urlCount = cards?.filter((c) => c.kind === 'url').length ?? 0;
  const verdictCounts = useMemo(() => countByVerdict(kindScopedCards ?? []), [kindScopedCards]);
  const guardedUrlCount =
    cards?.filter((card) => card.kind === 'url' && card.guardianEnabled).length ?? 0;

  const openRemoveConfirm = (card: TargetCard, trigger: HTMLButtonElement): void => {
    rememberTrigger(trigger);
    setConfirmCard(card);
  };

  const confirmRemove = (): void => {
    if (!confirmCard) return;
    if (confirmCard.kind === 'url' && onRemoveUrl) {
      const targetId = confirmCard.id;
      setConfirmCard(null);
      void onRemoveUrl(targetId);
      return;
    }
    if (confirmCard.kind === 'repo' && confirmCard.repositoryId && onRemoveRepo) {
      const repositoryId = confirmCard.repositoryId;
      setConfirmCard(null);
      void onRemoveRepo(repositoryId);
    }
  };

  const onSortChange = (event: ChangeEvent<HTMLSelectElement>): void => {
    const value = event.target.value;
    if (
      value === 'urgency' ||
      value === 'score-asc' ||
      value === 'score-desc' ||
      value === 'name' ||
      value === 'checked'
    ) {
      setSort(value);
    }
  };

  const emptyCopy = (): string => {
    if (verdictFilter !== 'all') {
      switch (verdictFilter) {
        case 'blocked':
          return 'No apps are blocked right now.';
        case 'review':
          return 'No apps need review right now.';
        case 'ready':
          return 'No apps are ready to ship yet.';
        case 'unknown':
          return 'Every listed app has been scanned.';
        default: {
          const neverFilter: never = verdictFilter;
          return neverFilter;
        }
      }
    }
    if (kindFilter === 'urls') {
      return 'No guarded URLs yet. Scan a live URL, then click “Guard this URL” and verify ownership.';
    }
    if (kindFilter === 'repos') {
      return 'No connected repositories yet. Install the Assurly GitHub App to guard a repo.';
    }
    return 'No guarded apps yet. Connect a repository, or scan a URL and guard it after ownership verification.';
  };

  return (
    <section className="verdict-section" aria-label="Your apps and their current verdict">
      <div className="verdict-section__header">
        <div>
          <h2 className="verdict-section__title">Your apps</h2>
          <p className="verdict-section__subtitle">
            {blockedCount > 0
              ? `${blockedCount} app${blockedCount === 1 ? '' : 's'} not safe to ship right now.`
              : guardedUrlCount > 0
                ? `Guarded apps — ${guardedUrlCount} URL${guardedUrlCount === 1 ? '' : 's'} on Continuous Guardian.`
                : 'Guarded apps only — connected repos and URLs you chose to guard.'}
          </p>
        </div>
        {cards && cards.length > 0 ? (
          <div className="verdict-section__toolbar">
            <label className="verdict-section__sort">
              <span className="visually-hidden">Sort apps</span>
              <select
                className="verdict-section__sort-select"
                value={sort}
                onChange={onSortChange}
                aria-label="Sort apps"
                data-testid="apps-sort"
              >
                {SORT_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <div className="verdict-section__density" role="group" aria-label="List density">
              <button
                type="button"
                className={`verdict-section__density-btn${density === 'comfortable' ? ' is-active' : ''}`}
                aria-pressed={density === 'comfortable'}
                onClick={() => setDensity('comfortable')}
                data-testid="apps-density-comfortable"
              >
                Cards
              </button>
              <button
                type="button"
                className={`verdict-section__density-btn${density === 'compact' ? ' is-active' : ''}`}
                aria-pressed={density === 'compact'}
                onClick={() => setDensity('compact')}
                data-testid="apps-density-compact"
              >
                Compact
              </button>
            </div>
          </div>
        ) : null}
      </div>

      {cards && cards.length > 0 ? (
        <div className="verdict-section__filters-stack">
          <div className="verdict-section__filters" role="group" aria-label="Filter apps by type">
            <button
              type="button"
              className={`verdict-section__filter${kindFilter === 'all' ? ' is-active' : ''}`}
              aria-pressed={kindFilter === 'all'}
              onClick={() => setKindFilter('all')}
            >
              All ({cards.length})
            </button>
            <button
              type="button"
              className={`verdict-section__filter${kindFilter === 'repos' ? ' is-active' : ''}`}
              aria-pressed={kindFilter === 'repos'}
              onClick={() => setKindFilter('repos')}
            >
              Repositories ({repoCount})
            </button>
            <button
              type="button"
              className={`verdict-section__filter${kindFilter === 'urls' ? ' is-active' : ''}`}
              aria-pressed={kindFilter === 'urls'}
              onClick={() => setKindFilter('urls')}
            >
              URLs ({urlCount})
            </button>
          </div>
          <div
            className="verdict-section__filters"
            role="group"
            aria-label="Filter apps by verdict"
          >
            <button
              type="button"
              className={`verdict-section__filter${verdictFilter === 'all' ? ' is-active' : ''}`}
              aria-pressed={verdictFilter === 'all'}
              onClick={() => setVerdictFilter('all')}
            >
              All verdicts
            </button>
            <button
              type="button"
              className={`verdict-section__filter verdict-section__filter--blocked${
                verdictFilter === 'blocked' ? ' is-active' : ''
              }`}
              aria-pressed={verdictFilter === 'blocked'}
              onClick={() => setVerdictFilter('blocked')}
            >
              Blocked ({verdictCounts.blocked})
            </button>
            <button
              type="button"
              className={`verdict-section__filter verdict-section__filter--review${
                verdictFilter === 'review' ? ' is-active' : ''
              }`}
              aria-pressed={verdictFilter === 'review'}
              onClick={() => setVerdictFilter('review')}
            >
              Review ({verdictCounts.review})
            </button>
            <button
              type="button"
              className={`verdict-section__filter verdict-section__filter--ready${
                verdictFilter === 'ready' ? ' is-active' : ''
              }`}
              aria-pressed={verdictFilter === 'ready'}
              onClick={() => setVerdictFilter('ready')}
            >
              Ready ({verdictCounts.ready})
            </button>
            <button
              type="button"
              className={`verdict-section__filter${verdictFilter === 'unknown' ? ' is-active' : ''}`}
              aria-pressed={verdictFilter === 'unknown'}
              onClick={() => setVerdictFilter('unknown')}
            >
              Unscanned ({verdictCounts.unknown})
            </button>
          </div>
        </div>
      ) : null}

      {error && (
        <p className="verdict-section__error" role="status">
          {error}
        </p>
      )}

      {visibleCards === null ? (
        <div className="verdict-section__loading" aria-hidden="true">
          <div className="verdict-card-skeleton" />
          <div className="verdict-card-skeleton" />
          <div className="verdict-card-skeleton" />
        </div>
      ) : visibleCards.length === 0 && !error ? (
        <p className="verdict-section__empty">{emptyCopy()}</p>
      ) : (
        <div
          className={`verdict-card-list${density === 'compact' ? ' verdict-card-list--compact' : ''}`}
          data-testid="apps-card-list"
        >
          {visibleCards.map((card) => (
            <VerdictCard
              key={card.id}
              card={card}
              density={density}
              onOpen={(c) => handleCardOpen(c, onOpenRepo)}
              onRescan={onRescan}
              rescanning={rescanningTargetId === rescanBusyKey(card)}
              rescanBlocked={rescanBlocked}
              onRemove={
                (card.kind === 'url' && onRemoveUrl) ||
                (card.kind === 'repo' && card.repositoryId && onRemoveRepo)
                  ? (trigger) => openRemoveConfirm(card, trigger)
                  : undefined
              }
              removing={
                card.kind === 'url'
                  ? removingTargetId === card.id
                  : removingRepositoryId === card.repositoryId
              }
            />
          ))}
        </div>
      )}

      {confirmCard ? (
        <div
          className="scan-delete-dialog__backdrop"
          data-testid="remove-url-dialog"
          onClick={() => setConfirmCard(null)}
        >
          <div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="remove-url-dialog-title"
            aria-describedby="remove-url-dialog-desc"
            className="scan-delete-dialog"
            onClick={(event) => event.stopPropagation()}
          >
            <h4 id="remove-url-dialog-title" className="scan-delete-dialog__title">
              {confirmCard.kind === 'repo' ? 'Remove repository?' : 'Remove guarded URL?'}
            </h4>
            <p id="remove-url-dialog-desc" className="scan-delete-dialog__desc">
              {confirmCard.kind === 'repo' ? (
                <>
                  Remove <strong>{confirmCard.displayName}</strong> from Your apps? You can add it
                  again later with Connect &amp; Scan. Scan history is kept.
                </>
              ) : (
                <>
                  Remove <strong>{confirmCard.displayName}</strong> from Your apps? Continuous
                  Guardian will stop watching this URL. You can guard it again later from a URL
                  scan.
                </>
              )}
            </p>
            <div className="scan-delete-dialog__actions">
              <button
                type="button"
                className="scan-delete-dialog__cancel"
                onClick={() => setConfirmCard(null)}
              >
                Cancel
              </button>
              <button type="button" className="scan-delete-dialog__confirm" onClick={confirmRemove}>
                {confirmCard.kind === 'repo' ? 'Remove repository' : 'Remove URL'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
