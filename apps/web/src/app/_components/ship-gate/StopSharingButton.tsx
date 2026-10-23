'use client';

import { useState, type ReactElement } from 'react';

interface StopSharingButtonProps {
  onStopSharing: () => void;
  isStopping: boolean;
  /** The README badge is served from the same token, so it stops too. */
  hasBadge: boolean;
}

/**
 * Two-step "Stop sharing": the link may already sit in an investor email or a
 * README, so the consequence is spelled out before it happens.
 */
export function StopSharingButton({
  onStopSharing,
  isStopping,
  hasBadge,
}: StopSharingButtonProps): ReactElement {
  const [confirming, setConfirming] = useState(false);

  if (!confirming) {
    return (
      <button
        type="button"
        className="ship-gate-share-stop"
        onClick={() => setConfirming(true)}
        disabled={isStopping}
      >
        Stop sharing
      </button>
    );
  }

  return (
    <div className="ship-gate-share-confirm" role="group" aria-label="Confirm stop sharing">
      <p className="ship-gate-share-confirm__text">
        {hasBadge
          ? 'Anyone with this link loses access, and the README badge stops showing. Sharing again creates a new link.'
          : 'Anyone with this link loses access. Sharing again creates a new link.'}
      </p>
      <div className="ship-gate-share-confirm__actions">
        <button
          type="button"
          className="ship-gate-share-stop ship-gate-share-stop--confirm"
          onClick={() => {
            setConfirming(false);
            onStopSharing();
          }}
          disabled={isStopping}
          aria-busy={isStopping}
        >
          {isStopping ? 'Stopping…' : 'Stop sharing'}
        </button>
        <button type="button" className="ship-gate-share-copy" onClick={() => setConfirming(false)}>
          Keep sharing
        </button>
      </div>
    </div>
  );
}
