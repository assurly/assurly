'use client';

import { useEffect, useState, type ReactElement } from 'react';
import {
  clientApi,
  type LiveLockSetupResult,
  type UrlTargetDetail,
} from '../../../utils/clientApi';
import { formatScanDateTime } from '../../../utils/scanHistoryDisplay';

type Check = UrlTargetDetail['liveLockChecks'][number];

const MAX_RUNS_SHOWN = 5;
const MAX_BLOCKERS_SHOWN = 3;

const NOT_VERIFIED: Record<string, string> = {
  deployment_protected:
    'Vercel Deployment Protection kept Assurly out, so the deploy went out unchecked. Approve the integration’s Protection Bypass permission in Vercel to check protected deploys.',
  probe_refused: 'The deployment refused the check, so it went out unchecked.',
  probe_unavailable: 'Assurly could not finish in time, so the deploy went out unchecked.',
  ownership_unverified:
    'Ownership of this URL is no longer verified, so the deploy went out unchecked.',
};

function runLabel(check: Check): { label: string; detail: string | null; tone: string } {
  if (check.status === 'registered') {
    return { label: 'Waiting for the build', detail: null, tone: 'pending' };
  }
  if (check.status === 'running') return { label: 'Checking…', detail: null, tone: 'pending' };
  if (check.conclusion === 'succeeded') {
    return { label: 'Passed', detail: 'Released to production.', tone: 'ready' };
  }
  if (check.conclusion === 'failed') {
    return {
      label: 'Held back',
      detail: 'Production stayed on the previous deploy.',
      tone: 'blocked',
    };
  }
  if (check.reason === 'runtime_blocker') {
    return {
      label: 'Would be held back',
      detail: 'Monitor mode released it. In enforce mode production would have stayed put.',
      tone: 'blocked',
    };
  }
  return {
    label: 'Not verified',
    detail: (check.reason && NOT_VERIFIED[check.reason]) ?? null,
    tone: 'neutral',
  };
}

function RecentRuns({ checks }: { checks: readonly Check[] }): ReactElement | null {
  if (checks.length === 0) return null;
  return (
    <ol className="url-proof__lock-runs" aria-label="Recent production deploys">
      {checks.slice(0, MAX_RUNS_SHOWN).map((check) => {
        const run = runLabel(check);
        const meta = [
          check.gitSha ? `Commit ${check.gitSha.slice(0, 7)}` : null,
          formatScanDateTime(check.checkedAt),
          check.shipScore !== null ? `${check.shipScore}/100` : null,
        ]
          .filter(Boolean)
          .join(' · ');
        return (
          <li
            key={check.deploymentId}
            className={`url-proof__lock-run url-proof__lock-run--${run.tone}`}
          >
            <p className="url-proof__lock-run-label">{run.label}</p>
            <p className="url-proof__lock-meta">{meta}</p>
            {run.detail ? <p>{run.detail}</p> : null}
            {check.blockers.length > 0 ? (
              <ul className="url-proof__lock-blockers">
                {check.blockers.slice(0, MAX_BLOCKERS_SHOWN).map((blocker) => (
                  <li key={`${blocker.ruleId}:${blocker.location}`}>{blocker.message}</li>
                ))}
              </ul>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

function setupMessage(result: LiveLockSetupResult | null): string | null {
  switch (result?.status) {
    case 'vercel_project_required':
      return 'No Vercel project lists this domain in production. Pick the one that deploys it.';
    case 'project_mismatch':
      return 'That project does not serve this domain in production. Pick another one.';
    case 'vercel_required':
      return 'Finish connecting Vercel in the window that opened, then come back here.';
    case 'vercel_not_configured':
      return 'Production protection on Vercel is not available yet.';
    default:
      return null;
  }
}

/**
 * Production protection for a verified URL on Vercel. Vercel holds each
 * production deployment until Assurly's check concludes. Monitor reports and
 * never holds; enforce holds a deploy with a proven blocker.
 */
export function ProductionProtectionPanel({
  targetId,
  ownershipVerified,
  setup,
  checks,
  onChanged,
}: {
  targetId: string;
  ownershipVerified: boolean;
  setup: UrlTargetDetail['liveLockSetup'];
  checks: readonly Check[];
  onChanged: () => void;
}): ReactElement | null {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<LiveLockSetupResult | null>(null);
  const [chosenProject, setChosenProject] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [awaitingInstall, setAwaitingInstall] = useState(false);

  // Vercel's install runs in its own window. Coming back to this tab is the
  // signal to finish linking: the callback has stored the installation.
  useEffect(() => {
    if (!awaitingInstall) return;
    const onFocus = (): void => {
      setAwaitingInstall(false);
      setResult(null);
      onChanged();
    };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [awaitingInstall, onChanged]);

  if (!ownershipVerified || !setup.vercelConfigured) return null;

  const run = (action: () => Promise<void>): void => {
    setBusy(true);
    setError(null);
    void action()
      .catch(() => setError('That did not go through. Try again.'))
      .finally(() => setBusy(false));
  };

  const enable = (projectId?: string): void =>
    run(async () => {
      const next = await clientApi.enableLiveLock(targetId, projectId);
      setResult(next);
      if (next.status === 'vercel_required' && next.installUrl) {
        const opened = window.open(
          next.installUrl,
          'assurly-vercel-install',
          'width=900,height=800',
        );
        if (!opened) {
          window.location.assign(next.installUrl);
          return;
        }
        setAwaitingInstall(true);
        return;
      }
      if (next.status === 'active') onChanged();
    });

  const setMode = (mode: 'monitor' | 'enforce' | 'off'): void =>
    run(async () => {
      await clientApi.setLiveLockMode(targetId, mode);
      setResult(null);
      onChanged();
    });

  const projects = result?.projects ?? [];
  const message = setupMessage(result);

  return (
    <section className="url-proof__lock url-proof__lock--setup" aria-label="Production protection">
      <h5 className="url-proof__lock-title">Production protection · Vercel</h5>
      {setup.mode ? (
        <>
          <p>
            {setup.mode === 'enforce'
              ? `On for ${setup.projectName}. A production deploy with a proven blocker stays off your domain.`
              : `Monitoring ${setup.projectName}. Every production deploy is checked; none is held back yet.`}
          </p>
          <div className="url-proof__lock-actions">
            {setup.mode === 'monitor' ? (
              <button
                type="button"
                className="dashboard-scan-action-btn dashboard-scan-action-btn--primary"
                disabled={busy}
                onClick={() => setMode('enforce')}
              >
                Hold back blocked deploys
              </button>
            ) : (
              <button
                type="button"
                className="dashboard-scan-action-btn dashboard-scan-action-btn--secondary"
                disabled={busy}
                onClick={() => setMode('monitor')}
              >
                Only monitor
              </button>
            )}
            <button
              type="button"
              className="dashboard-scan-action-btn dashboard-scan-action-btn--secondary"
              disabled={busy}
              onClick={() => setMode('off')}
            >
              Turn off
            </button>
          </div>
          {setup.mode === 'enforce' ? (
            <p className="url-proof__lock-meta">
              Vercel’s Force Promote still ships a held deploy if you need to.
            </p>
          ) : null}
        </>
      ) : (
        <>
          <p>
            Check every production deploy on Vercel before it reaches your domain. It starts in
            monitor mode, so nothing is held back until you choose.
          </p>
          {message ? <p role="status">{message}</p> : null}
          {projects.length > 0 ? (
            <div className="url-proof__lock-actions">
              <label className="url-proof__lock-select">
                <span>Vercel project</span>
                <select
                  value={chosenProject}
                  onChange={(event) => setChosenProject(event.target.value)}
                >
                  <option value="">Choose a project</option>
                  {projects.map((project) => (
                    <option key={project.id} value={project.id}>
                      {project.name}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                className="dashboard-scan-action-btn dashboard-scan-action-btn--primary"
                disabled={busy || !chosenProject}
                onClick={() => enable(chosenProject)}
              >
                Use this project
              </button>
            </div>
          ) : result?.status !== 'vercel_not_configured' ? (
            <div className="url-proof__lock-actions">
              <button
                type="button"
                className="dashboard-scan-action-btn dashboard-scan-action-btn--primary"
                disabled={busy}
                onClick={() => enable()}
              >
                {busy ? 'Connecting…' : 'Protect production deploys'}
              </button>
            </div>
          ) : null}
        </>
      )}
      {error ? <p role="alert">{error}</p> : null}
      <RecentRuns checks={checks} />
    </section>
  );
}
