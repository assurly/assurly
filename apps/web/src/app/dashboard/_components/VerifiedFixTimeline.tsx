'use client';

import type { ReactElement } from 'react';
import type { FixOutcomeStatus } from '../../../utils/dbAdapter';

export interface VerifiedFixTimelineProps {
  outcome: FixOutcomeStatus;
  /** When the finding was first detected. */
  foundAt?: string | null;
  /** The fix PR that plausibly closed it. */
  prUrl?: string | null;
  prLabel?: string | null;
  /** When the re-probe confirmed the outcome. */
  verifiedAt?: string | null;
}

const STATUS_COPY: Record<FixOutcomeStatus, { label: string; modifier: string }> = {
  verified_fixed: { label: 'Verified fixed', modifier: 'verified' },
  still_open: { label: 'Still open', modifier: 'open' },
  regressed: { label: 'Regressed', modifier: 'regressed' },
};

function formatTime(value: string | null | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * The emotional payoff of the verified-fix loop (Phase 5): a "VERIFIED FIXED"
 * badge and the timeline that proves it — found → fixed by PR → verified closed.
 * Purely presentational; the outcome and timestamps are resolved server-side.
 */
export function VerifiedFixTimeline({
  outcome,
  foundAt,
  prUrl,
  prLabel,
  verifiedAt,
}: VerifiedFixTimelineProps): ReactElement {
  const status = STATUS_COPY[outcome];
  const foundLabel = formatTime(foundAt);
  const verifiedLabel = formatTime(verifiedAt);
  const verifiedVerb = outcome === 'verified_fixed' ? 'verified closed' : 'last checked';

  return (
    <div
      className={`verified-fix verified-fix--${status.modifier}`}
      data-testid="verified-fix-timeline"
    >
      <span
        className={`verified-fix__badge verified-fix__badge--${status.modifier}`}
        data-testid="verified-fix-badge"
      >
        {outcome === 'verified_fixed' ? <span aria-hidden="true">✓ </span> : null}
        {status.label}
      </span>
      <ol className="verified-fix__timeline">
        {foundLabel ? (
          <li className="verified-fix__step">
            <span className="verified-fix__step-label">Found</span>
            <span className="verified-fix__step-time">{foundLabel}</span>
          </li>
        ) : null}
        {prUrl ? (
          <li className="verified-fix__step">
            <span className="verified-fix__step-label">Fixed by</span>
            <a
              className="verified-fix__step-link"
              href={prUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              {prLabel ?? 'pull request'} <span aria-hidden="true">↗</span>
            </a>
          </li>
        ) : null}
        {verifiedLabel ? (
          <li className="verified-fix__step">
            <span className="verified-fix__step-label">{verifiedVerb}</span>
            <span className="verified-fix__step-time">{verifiedLabel}</span>
          </li>
        ) : null}
      </ol>
    </div>
  );
}
