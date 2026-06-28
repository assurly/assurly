'use client';

import { useEffect } from 'react';

interface OAuthCodeRecoveryProps {
  callbackUrl: string;
}

export function OAuthCodeRecovery({ callbackUrl }: OAuthCodeRecoveryProps): React.ReactElement {
  useEffect(() => {
    window.location.replace(callbackUrl);
  }, [callbackUrl]);

  return (
    <main className="route-state" aria-busy="true" aria-live="polite">
      <div className="route-state-card">
        <span className="route-state-spinner" aria-hidden="true" />
        <h1>Completing secure sign-in</h1>
        <p>Returning to the canonical ShipReady callback…</p>
        <a className="btn btn-primary" href={callbackUrl}>
          Continue sign-in
        </a>
      </div>
    </main>
  );
}
