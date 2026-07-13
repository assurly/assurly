'use client';

import { useCallback, useEffect, useState, type ReactElement } from 'react';
import { clientApi, ClientApiError, type TargetCard } from '../../../utils/clientApi';
import { VerdictCard } from './VerdictCard';

interface VerdictCardsSectionProps {
  /** Open the app's detail (selects the repo in the existing scan flow). */
  onOpenRepo: (repositoryId: string) => void;
  /** Bump to re-fetch verdicts (e.g. after a scan completes). */
  refreshKey?: number;
}

/**
 * The dashboard's primary surface (Phase 1): one always-current verdict per app.
 * Replaces the raw repository list as the lead — "can I ship this right now?" at
 * a glance — with the underlying repo/scan flow demoted to a detail view.
 */
export function VerdictCardsSection({
  onOpenRepo,
  refreshKey = 0,
}: VerdictCardsSectionProps): ReactElement {
  const [cards, setCards] = useState<TargetCard[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const { targets } = await clientApi.targets();
      setCards(targets);
    } catch (err) {
      const message =
        err instanceof ClientApiError ? err.message : 'Could not load your apps right now.';
      setError(message);
      setCards([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  const blockedCount = cards?.filter((c) => c.verdict === 'blocked').length ?? 0;

  return (
    <section className="verdict-section" aria-label="Your apps and their current verdict">
      <header className="verdict-section__header">
        <div>
          <h2 className="verdict-section__title">Your apps</h2>
          <p className="verdict-section__subtitle">
            {blockedCount > 0
              ? `${blockedCount} app${blockedCount === 1 ? '' : 's'} not safe to ship right now.`
              : 'Can I ship this right now? — one verdict per app, always current.'}
          </p>
        </div>
      </header>

      {error && (
        <p className="verdict-section__error" role="status">
          {error}
        </p>
      )}

      {cards === null ? (
        <div className="verdict-section__loading" aria-hidden="true">
          <div className="verdict-card-skeleton" />
          <div className="verdict-card-skeleton" />
          <div className="verdict-card-skeleton" />
        </div>
      ) : cards.length === 0 && !error ? (
        <p className="verdict-section__empty">
          No apps yet. Connect a repository or scan a URL to get your first verdict.
        </p>
      ) : (
        <div className="verdict-card-list">
          {cards.map((card) => (
            <VerdictCard key={card.id} card={card} onOpen={(c) => onOpenRepo(c.repositoryId)} />
          ))}
        </div>
      )}
    </section>
  );
}
