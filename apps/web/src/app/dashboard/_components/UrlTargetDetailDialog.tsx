'use client';

import { useEffect, useState, type ReactElement } from 'react';
import { useAccessibleMenu } from '../../../hooks/useAccessibleMenu';
import {
  ClientApiError,
  clientApi,
  type TargetCard,
  type UrlTargetDetail,
  type UrlTargetEvidence,
} from '../../../utils/clientApi';
import { formatScanDateTime } from '../../../utils/scanHistoryDisplay';
import { EvidenceDetail } from './ProofEvidence';
import { verdictStatusLabel } from './VerdictCard';
import { VerifiedFixTimeline } from './VerifiedFixTimeline';

interface UrlTargetDetailDialogProps {
  card: TargetCard;
  onClose: () => void;
  /** Re-runs the same ownership-gated, read-only probe; resolves when it is done. */
  onRescan: (card: TargetCard) => Promise<void>;
  rescanning: boolean;
  rescanBlocked: boolean;
}

type LoadState =
  | { status: 'loading' }
  | { status: 'ready'; detail: UrlTargetDetail }
  | { status: 'error'; message: string };

function ProofBlock({ evidence }: { evidence: UrlTargetEvidence }): ReactElement {
  return (
    <div className="url-proof__evidence">
      <p className="url-proof__summary">{evidence.summary}</p>
      <EvidenceDetail item={evidence} />
      <p className="url-proof__taken">Proof taken {formatScanDateTime(evidence.checkedAt)}</p>
    </div>
  );
}

function liveLockCopy(lock: UrlTargetDetail['liveLock']): { title: string; body: string } {
  if (lock.status === null) {
    return {
      title: 'Not called yet',
      body: 'No deploy has called Live Lock yet.',
    };
  }
  if (lock.status === 'blocked') {
    return {
      title: 'BLOCKED',
      body: lock.stoppedDeploy
        ? 'Live Lock stopped a deploy. The fresh check still found a blocker.'
        : 'The latest Live Lock check is blocked.',
    };
  }
  return {
    title: 'READY',
    body: lock.stoppedDeploy
      ? 'The latest check passed. An earlier deploy was stopped.'
      : 'The latest check passed. Live Lock is on after it stops a deploy.',
  };
}

type EnableLiveLockResult = Awaited<ReturnType<typeof clientApi.enableLiveLock>>;

function enableStatusCopy(status: EnableLiveLockResult['status']): string {
  switch (status) {
    case 'ownership_required':
      return 'Verify you own this URL before Live Lock can stop a deploy.';
    case 'repo_required':
      return 'Connect the GitHub repository that deploys this URL.';
    case 'github_permission_required':
      return 'Allow Assurly to store the deploy secret on that repository.';
    case 'vercel_not_configured':
      return 'Vercel is not connected on this workspace yet.';
    case 'vercel_required':
      return 'Connect Vercel so production waits for this check.';
    case 'vercel_project_required':
      return 'No Vercel project uses this URL yet.';
    case 'ignored_build_conflict':
      return 'This project already has its own ignored-build command, so production was left as it is.';
    case 'workflow_blocked':
      return 'The secret is stored. GitHub did not accept the workflow file from here.';
    case 'locked':
      return 'Live Lock is on. The next preview is checked before production.';
    default: {
      const exhaustive: never = status;
      return exhaustive;
    }
  }
}

function LiveLockPanel({
  lock,
  setup,
  ownershipVerified,
  action,
  locking,
  onLock,
}: {
  lock: UrlTargetDetail['liveLock'];
  setup: UrlTargetDetail['liveLockSetup'];
  ownershipVerified: boolean;
  action: EnableLiveLockResult | null;
  locking: boolean;
  onLock: () => void;
}): ReactElement {
  const copy = liveLockCopy(lock);
  const when = lock.checkedAt ? `Checked ${formatScanDateTime(lock.checkedAt)}` : null;
  const sha = lock.gitSha ? `Commit ${lock.gitSha.slice(0, 7)}` : null;
  const meta = [when, sha, lock.shipScore !== null ? `${lock.shipScore}/100` : null]
    .filter(Boolean)
    .join(' · ');
  const note = action ? enableStatusCopy(action.status) : null;
  const pullRequestUrl = action?.pullRequestUrl ?? setup.pullRequestUrl;

  return (
    <section
      className={`url-proof__lock${lock.status ? ` url-proof__lock--${lock.status}` : ''}`}
      aria-label="Live Lock"
      data-testid="live-lock"
    >
      <h5 className="url-proof__lock-title">Live Lock · {copy.title}</h5>
      <p>{copy.body}</p>
      {meta ? <p className="url-proof__lock-meta">{meta}</p> : null}
      {!ownershipVerified ? (
        <p>Verify you own this URL before Live Lock can stop a deploy.</p>
      ) : null}
      {ownershipVerified && !setup.repositoryName && !action ? (
        <p>Connect the GitHub repository that deploys this URL.</p>
      ) : null}
      {note ? <p role="status">{note}</p> : null}
      {setup.locked && !note ? (
        <p>Live Lock is on. The next preview is checked before production.</p>
      ) : null}
      {pullRequestUrl ? (
        <p>
          <a href={pullRequestUrl}>Workflow pull request</a>
        </p>
      ) : null}
      {ownershipVerified && !setup.locked ? (
        action?.installUrl ? (
          <p>
            <a href={action.installUrl}>Allow secret access</a>
          </p>
        ) : action?.connectPath ? (
          <p>
            <a href={action.connectPath}>Connect Vercel</a>
          </p>
        ) : (
          <button
            type="button"
            className="dashboard-scan-action-btn dashboard-scan-action-btn--primary url-proof__lock-action"
            disabled={locking || !setup.repositoryName}
            onClick={onLock}
          >
            {locking ? 'Locking…' : 'Lock deploys'}
          </button>
        )
      ) : null}
    </section>
  );
}

function DetailBody({ detail }: { detail: UrlTargetDetail }): ReactElement {
  return (
    <>
      {detail.blockers.length === 0 ? (
        <p className="url-proof__empty">The last check found nothing that blocks launch.</p>
      ) : (
        <ol className="url-proof__blockers" aria-label="What the last check proved">
          {detail.blockers.map((blocker) => (
            <li key={blocker.ruleId} className="url-proof__blocker">
              <h5 className="url-proof__blocker-title">{blocker.message}</h5>
              <p className="url-proof__location">{blocker.location}</p>
              {blocker.evidence ? (
                <ProofBlock evidence={blocker.evidence} />
              ) : (
                <p className="url-proof__missing">
                  No proof is stored for this finding yet. Run the check again to capture it.
                </p>
              )}
              {blocker.outcome ? (
                <VerifiedFixTimeline
                  outcome={blocker.outcome.status}
                  foundAt={blocker.outcome.foundAt}
                  verifiedAt={
                    blocker.outcome.status === 'verified_fixed'
                      ? blocker.outcome.since
                      : detail.lastCheckedAt
                  }
                />
              ) : null}
            </li>
          ))}
        </ol>
      )}

      {detail.otherEvidence.length > 0 ? (
        <section className="url-proof__other" aria-label="Also seen, not blocking">
          <h5 className="url-proof__other-title">Also seen · not blocking</h5>
          <ul>
            {detail.otherEvidence.map((item) => (
              <li key={item.findingRuleId}>{item.summary}</li>
            ))}
          </ul>
        </section>
      ) : null}
    </>
  );
}

/**
 * The proof behind a guarded URL's verdict. A blocker that says "rows could be
 * read" has to show which table, how many rows and when — and the same
 * read-only check has to be one click away once the fix is deployed.
 */
export function UrlTargetDetailDialog({
  card,
  onClose,
  onRescan,
  rescanning,
  rescanBlocked,
}: UrlTargetDetailDialogProps): ReactElement {
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const [reloadKey, setReloadKey] = useState(0);
  const [locking, setLocking] = useState(false);
  const [lockAction, setLockAction] = useState<EnableLiveLockResult | null>(null);
  const { menuRef: dialogRef } = useAccessibleMenu<HTMLDivElement>({ open: true, onClose });

  useEffect(() => {
    let cancelled = false;
    clientApi
      .targetDetail(card.id)
      .then((detail) => {
        if (!cancelled) setState({ status: 'ready', detail });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setState({
          status: 'error',
          message:
            error instanceof ClientApiError && error.message
              ? error.message
              : 'Could not load the proof for this app. Try again.',
        });
      });
    return () => {
      cancelled = true;
    };
  }, [card.id, reloadKey]);

  const detail = state.status === 'ready' ? state.detail : null;
  const ownershipVerified = detail?.ownershipVerified ?? card.ownershipVerified;
  const verdict = detail?.verdict ?? card.verdict;
  const shipScore = detail ? detail.shipScore : card.shipScore;
  const lastCheckedAt = detail ? detail.lastCheckedAt : card.lastCheckedAt;
  const statusLine = [
    verdictStatusLabel(verdict),
    shipScore !== null ? `${shipScore}/100` : null,
    lastCheckedAt ? `Checked ${formatScanDateTime(lastCheckedAt)}` : null,
  ]
    .filter(Boolean)
    .join(' · ');
  const titleId = `url-proof-title-${card.id}`;

  const rescan = async (): Promise<void> => {
    await onRescan(card);
    setReloadKey((key) => key + 1);
  };

  return (
    <div className="scan-delete-dialog__backdrop" data-testid="url-proof-dialog" onClick={onClose}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="scan-delete-dialog url-proof"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="url-proof__header">
          <h4 id={titleId} className="scan-delete-dialog__title">
            {card.displayName}
          </h4>
          <button
            type="button"
            className="url-proof__close"
            aria-label="Close proof"
            onClick={onClose}
          >
            ×
          </button>
        </div>
        <p className="url-proof__status">{statusLine}</p>

        {state.status === 'loading' ? <p className="url-proof__loading">Loading proof…</p> : null}
        {state.status === 'error' ? (
          <p className="url-proof__error" role="alert">
            {state.message}
          </p>
        ) : null}
        {detail ? (
          <>
            <LiveLockPanel
              lock={detail.liveLock}
              setup={detail.liveLockSetup}
              ownershipVerified={ownershipVerified}
              action={lockAction}
              locking={locking}
              onLock={() => {
                setLocking(true);
                void clientApi
                  .enableLiveLock(card.id)
                  .then((result) => {
                    setLockAction(result);
                    setReloadKey((key) => key + 1);
                  })
                  .catch(() => {
                    setLockAction({
                      status: 'workflow_blocked',
                      installUrl: null,
                      connectPath: null,
                      pullRequestUrl: null,
                    });
                  })
                  .finally(() => setLocking(false));
              }}
            />
            <DetailBody detail={detail} />
          </>
        ) : null}

        <div className="url-proof__footer">
          {ownershipVerified ? (
            <button
              type="button"
              className="dashboard-scan-action-btn dashboard-scan-action-btn--primary"
              disabled={rescanBlocked || rescanning}
              onClick={() => void rescan()}
            >
              {rescanning ? 'Checking…' : 'Run the same check again'}
            </button>
          ) : (
            <p className="url-proof__hint">
              Verify you own this URL to re-run the data check. Until then Assurly only runs passive
              checks.
            </p>
          )}
          <p className="url-proof__hint">
            Read-only: Assurly reads with your app&apos;s public key and never writes. Shown values
            are masked.
          </p>
        </div>
      </div>
    </div>
  );
}
