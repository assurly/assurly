'use client';

import type { ReactElement } from 'react';
import type { TargetCard } from '../../../utils/clientApi';
import { consequenceForGroupKey } from '../../../utils/consequenceMap';

interface VerdictCardProps {
  card: TargetCard;
  onOpen: (card: TargetCard) => void;
}

type VerdictKey = TargetCard['verdict'];

const VERDICT_META: Record<VerdictKey, { label: string; emoji: string; className: string }> = {
  blocked: { label: 'Not ready to ship', emoji: '🚫', className: 'verdict-card--blocked' },
  review: { label: 'Review recommended', emoji: '⚠️', className: 'verdict-card--review' },
  ready: { label: 'Ready to ship', emoji: '✅', className: 'verdict-card--ready' },
  unknown: { label: 'Not scanned yet', emoji: '○', className: 'verdict-card--unknown' },
};

const FINGERPRINT_LABEL: Record<string, string> = {
  lovable: 'Lovable',
  v0: 'v0',
  bolt: 'Bolt',
  cursor: 'Cursor',
  replit: 'Replit',
};

/** Compact "checked 2h ago" freshness, or a dash when never scanned. */
export function formatCheckedAt(iso: string | null, now: number = Date.now()): string {
  if (!iso) return 'Never scanned';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return 'Never scanned';
  const seconds = Math.max(0, Math.round((now - then) / 1000));
  if (seconds < 60) return 'Checked just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `Checked ${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `Checked ${hours}h ago`;
  const days = Math.round(hours / 24);
  return `Checked ${days}d ago`;
}

export function VerdictCard({ card, onOpen }: VerdictCardProps): ReactElement {
  const meta = VERDICT_META[card.verdict];
  const fingerprintLabel = card.generatorFingerprint
    ? FINGERPRINT_LABEL[card.generatorFingerprint]
    : undefined;

  return (
    <button
      type="button"
      className={`verdict-card ${meta.className}`}
      onClick={() => onOpen(card)}
      aria-label={`${card.displayName}: ${meta.label}`}
    >
      <span className="verdict-card__status" aria-hidden="true">
        {meta.emoji}
      </span>

      <span className="verdict-card__body">
        <span className="verdict-card__title-row">
          <span className="verdict-card__name">{card.displayName}</span>
          {fingerprintLabel && (
            <span className="verdict-card__chip" title="Detected AI builder">
              {fingerprintLabel}
            </span>
          )}
          {card.guardianEnabled ? (
            <span
              className="verdict-card__chip verdict-card__chip--guardian"
              title="Continuous Guardian"
            >
              Guardian
            </span>
          ) : null}
        </span>
        <span className="verdict-card__verdict">{meta.label}</span>
        {card.topIssue ? (
          <span className="verdict-card__issue">
            {consequenceForGroupKey(card.topIssue.key)?.consequence ?? card.topIssue.sampleMessage}
          </span>
        ) : card.verdict === 'ready' ? (
          <span className="verdict-card__issue verdict-card__issue--clean">
            No blockers — safe to deploy.
          </span>
        ) : (
          <span className="verdict-card__issue verdict-card__issue--muted">
            Run a scan to get a verdict.
          </span>
        )}
        {card.scoreDropped ? (
          <span className="verdict-card__regression" role="status">
            Score dropped since last check
          </span>
        ) : null}
      </span>

      <span className="verdict-card__meta">
        <span className="verdict-card__score">
          {card.shipScore === null ? '—' : `${card.shipScore}`}
          <span className="verdict-card__score-max">/100</span>
        </span>
        <span className="verdict-card__freshness">{formatCheckedAt(card.lastCheckedAt)}</span>
      </span>
    </button>
  );
}
