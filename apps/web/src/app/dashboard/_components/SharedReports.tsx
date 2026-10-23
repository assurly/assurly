'use client';

import { useEffect, useState, type ReactElement } from 'react';
import { StopSharingButton } from '../../_components/ship-gate/StopSharingButton';
import { clientApi, type SharedReport } from '../../../utils/clientApi';
import { formatScanDateTime } from '../../../utils/scanHistoryDisplay';

type LoadState =
  | { status: 'loading' }
  | { status: 'ready'; shares: SharedReport[] }
  | { status: 'error' };

const VERDICT_LABEL: Readonly<Record<string, string>> = {
  blocked: 'Not ready to ship',
  review: 'Review recommended',
  ready: 'Ready to ship',
};

function describeShare(share: SharedReport): string {
  return [
    share.branch,
    // A scan that failed before reading a commit stores "unknown".
    /^[0-9a-f]{7,64}$/i.test(share.commitSha) ? share.commitSha.slice(0, 7) : null,
    formatScanDateTime(share.createdAt),
    share.verdict ? (VERDICT_LABEL[share.verdict] ?? null) : null,
  ]
    .filter(Boolean)
    .join(' · ');
}

/**
 * Every report this workspace made public, in one place. A link handed out
 * months ago can still expose a list of open security problems; without this
 * list the only way to find it was to click through each scan.
 */
export function SharedReports(): ReactElement {
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const [stoppingId, setStoppingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    clientApi
      .sharedReports()
      .then(({ shares }) => {
        if (!cancelled) setState({ status: 'ready', shares });
      })
      .catch(() => {
        if (!cancelled) setState({ status: 'error' });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const stopSharing = async (scanId: string): Promise<void> => {
    setStoppingId(scanId);
    setError(null);
    try {
      await clientApi.stopSharingScan(scanId);
      setState((current) =>
        current.status === 'ready'
          ? { status: 'ready', shares: current.shares.filter((share) => share.scanId !== scanId) }
          : current,
      );
    } catch (stopError) {
      setError(stopError instanceof Error ? stopError.message : 'Could not stop sharing.');
    } finally {
      setStoppingId(null);
    }
  };

  return (
    <section className="dashboard-public-connect api-keys" aria-label="Shared reports">
      <h4 className="dashboard-public-connect__title">Shared reports</h4>
      <p className="dashboard-public-connect__copy">
        Anyone with one of these links can open the report, including its open findings. Stop
        sharing a link you no longer need.
      </p>

      {error ? (
        <p className="dashboard-public-connect__error" role="alert">
          {error}
        </p>
      ) : null}

      {state.status === 'loading' ? <p className="api-keys__empty">Loading shared links…</p> : null}
      {state.status === 'error' ? (
        <p className="dashboard-public-connect__error" role="alert">
          Could not load your shared links. Refresh to try again.
        </p>
      ) : null}
      {state.status === 'ready' && state.shares.length === 0 ? (
        <p className="api-keys__empty">No report is shared publicly.</p>
      ) : null}
      {state.status === 'ready' && state.shares.length > 0 ? (
        <ul className="api-keys__list" aria-label="Publicly shared reports">
          {state.shares.map((share) => (
            <li key={share.scanId} className="api-keys__item shared-reports__item">
              <div className="api-keys__item-body">
                <div className="api-keys__item-main">
                  <a
                    className="api-keys__item-label"
                    href={share.url}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {share.repositoryName}
                  </a>
                </div>
                <p className="api-keys__item-meta">{describeShare(share)}</p>
              </div>
              <div className="api-keys__item-side shared-reports__side">
                <StopSharingButton
                  onStopSharing={() => void stopSharing(share.scanId)}
                  isStopping={stoppingId === share.scanId}
                  hasBadge
                />
              </div>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
