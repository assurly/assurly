'use client';

import { useCallback, useEffect, useState, type ReactElement } from 'react';
import { ASSURLY_CANARY_ENV_KEY } from '@assurly/scanner-core';
import { ClientApiError, clientApi, type CanaryTokenSummary } from '../../../utils/clientApi';
import {
  CANARY_HIT_ROTATE_COPY,
  CANARY_SILENT_ALARM_LABEL,
  buildCanaryCopyPayload,
} from '../../../utils/canaryPlant';
import { formatApiKeyDay } from '../../../utils/apiKeyDisplay';
import { CanaryTokensNotice } from './CanaryTokens';

export interface CanarySilentAlarmProps {
  targetId: string;
  hasGitHubInstallation?: boolean;
}

/**
 * Post-scan tripwire CTA. GitHub App → Open plant PR; otherwise Copy snippet.
 * Issue / Revoke stay in Settings.
 */
export function CanarySilentAlarm({
  targetId,
  hasGitHubInstallation = false,
}: CanarySilentAlarmProps): ReactElement {
  const [tokens, setTokens] = useState<CanaryTokenSummary[]>([]);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [freshSnippet, setFreshSnippet] = useState<string | null>(null);
  const [mcpSnippet, setMcpSnippet] = useState<string | null>(null);
  const [prUrl, setPrUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [ownershipBlocked, setOwnershipBlocked] = useState(false);
  const [plantedOnRepo, setPlantedOnRepo] = useState(false);

  const load = useCallback(async (): Promise<void> => {
    try {
      const { tokens: rows } = await clientApi.canary.list(targetId);
      setTokens(rows);
      setOwnershipBlocked(false);
    } catch (loadError) {
      if (loadError instanceof ClientApiError && loadError.code === 'ownership_required') {
        setOwnershipBlocked(true);
        setTokens([]);
        return;
      }
      console.warn(
        '[Assurly] failed to load silent alarm:',
        loadError instanceof Error ? loadError.message : loadError,
      );
    }
  }, [targetId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- mount-time / target change fetch
    void load();
  }, [load]);

  const activeTokens = tokens.filter((token) => !token.revokedAt);
  const hitTokens = tokens.filter((token) => token.lastHitAt !== null || token.hitCount > 0);
  const armedNeverUsed = activeTokens.length > 0 && hitTokens.length === 0;
  const copyPayload =
    freshSnippet && mcpSnippet ? buildCanaryCopyPayload(freshSnippet, mcpSnippet) : freshSnippet;

  const rememberIssued = (created: {
    id: string;
    label: string;
    tokenPrefix: string;
    snippet: string;
    mcpSnippet?: string;
    createdAt: string;
  }): void => {
    setFreshSnippet(created.snippet);
    setMcpSnippet(created.mcpSnippet ?? null);
    setTokens((current) => [
      {
        id: created.id,
        label: created.label,
        tokenPrefix: created.tokenPrefix,
        hitCount: 0,
        lastHitAt: null,
        revokedAt: null,
        createdAt: created.createdAt,
      },
      ...current,
    ]);
    setOwnershipBlocked(false);
    setPlantedOnRepo(false);
  };

  const issueCopyFallback = async (): Promise<boolean> => {
    try {
      const created = await clientApi.canary.issue(targetId, CANARY_SILENT_ALARM_LABEL);
      rememberIssued(created);
      return true;
    } catch (createError) {
      if (createError instanceof ClientApiError && createError.code === 'ownership_required') {
        setOwnershipBlocked(true);
      }
      setError(
        createError instanceof Error ? createError.message : 'Could not add the silent alarm.',
      );
      return false;
    }
  };

  const handleAdd = async (): Promise<void> => {
    setCreating(true);
    setError(null);
    setCopied(false);
    try {
      await issueCopyFallback();
    } finally {
      setCreating(false);
    }
  };

  const handlePlantPr = async (): Promise<void> => {
    setCreating(true);
    setError(null);
    setCopied(false);
    try {
      const planted = await clientApi.canary.plant(targetId);
      if (planted.alreadyPlanted) {
        setFreshSnippet(null);
        setMcpSnippet(null);
        setPrUrl(planted.prUrl ?? null);
        setPlantedOnRepo(true);
        setOwnershipBlocked(false);
        return;
      }
      setPlantedOnRepo(false);
      setFreshSnippet(planted.snippet);
      setMcpSnippet(planted.mcpSnippet ?? null);
      setPrUrl(planted.prUrl ?? null);
      if (planted.id) {
        setTokens((current) => [
          {
            id: planted.id as string,
            label: CANARY_SILENT_ALARM_LABEL,
            tokenPrefix: planted.tokenPrefix ?? 'ask_canary_',
            hitCount: 0,
            lastHitAt: null,
            revokedAt: null,
            createdAt: planted.createdAt ?? new Date().toISOString(),
          },
          ...current,
        ]);
      }
      setOwnershipBlocked(false);
    } catch (plantError) {
      if (plantError instanceof ClientApiError && plantError.code === 'ownership_required') {
        setOwnershipBlocked(true);
        setError(plantError.message);
        return;
      }
      const issued = await issueCopyFallback();
      if (issued) {
        const plantMessage =
          plantError instanceof Error
            ? plantError.message
            : 'Could not open the plant pull request.';
        setError(`${plantMessage} Paste the snippet into .env.example, or retry Open plant PR.`);
      }
    } finally {
      setCreating(false);
    }
  };

  const handlePrimary = hasGitHubInstallation ? handlePlantPr : handleAdd;

  const handleCopy = async (): Promise<void> => {
    if (!copyPayload) return;
    try {
      await navigator.clipboard.writeText(copyPayload);
      setCopied(true);
    } catch {
      // Clipboard may be unavailable — the snippet stays visible to copy manually.
    }
  };

  const primaryLabel = hasGitHubInstallation
    ? creating
      ? 'Opening…'
      : 'Open plant PR'
    : creating
      ? activeTokens.length === 0
        ? 'Adding…'
        : 'Generating…'
      : activeTokens.length === 0
        ? 'Add a silent alarm'
        : 'Show plant snippet';

  if (ownershipBlocked) {
    return (
      <CanaryTokensNotice ariaLabel="Silent alarm">
        Verify ownership of this app first. A silent alarm is a tripwire URL you plant in
        .env.example — Assurly alerts if anyone ever fetches it.
      </CanaryTokensNotice>
    );
  }

  return (
    <section
      id="canary-silent-alarm"
      className="dashboard-public-connect api-keys canary-tokens canary-silent-alarm"
      aria-label="Silent alarm"
      data-testid="canary-silent-alarm"
    >
      <h4 className="dashboard-public-connect__title">
        {activeTokens.length > 0 ? 'Silent alarm' : 'Add a silent alarm'}
      </h4>
      {activeTokens.length === 0 ? (
        <p className="dashboard-public-connect__copy">
          If someone steals your env, Assurly will let you know. One click. Paste the snippet into
          .env.example as {ASSURLY_CANARY_ENV_KEY} — never as a real Stripe, Supabase, or database
          URL.
        </p>
      ) : armedNeverUsed ? (
        <p className="canary-silent-alarm__status" role="status">
          Armed · Never used
        </p>
      ) : null}

      {activeTokens.length === 0 ||
      (!freshSnippet && armedNeverUsed && !plantedOnRepo) ||
      (hasGitHubInstallation && Boolean(error) && !prUrl) ? (
        <>
          {activeTokens.length > 0 && !freshSnippet ? (
            <p className="dashboard-public-connect__copy">
              The tripwire URL is shown once. If it is not in .env.example yet, generate a new
              snippet and plant it as {ASSURLY_CANARY_ENV_KEY}.
            </p>
          ) : null}
          <button
            type="button"
            className="dashboard-public-connect__submit"
            onClick={() => void handlePrimary()}
            disabled={creating}
            aria-busy={creating}
          >
            {primaryLabel}
          </button>
        </>
      ) : null}

      {plantedOnRepo ? (
        <p className="dashboard-public-connect__copy" role="status">
          {ASSURLY_CANARY_ENV_KEY} is already in .env.example on the connected repository.
        </p>
      ) : null}

      {prUrl ? (
        <div className="scan-finding-action-row">
          <a
            href={prUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="scan-finding-action-btn scan-finding-action-btn--success"
          >
            <span aria-hidden="true">↗</span> Open plant pull request
          </a>
        </div>
      ) : null}

      {freshSnippet ? (
        <div className="api-keys__reveal" role="status">
          <p className="api-keys__reveal-title">
            Copy this into .env.example now — the tripwire URL will not be shown again.
          </p>
          <div className="api-keys__reveal-row">
            <pre className="canary-silent-alarm__snippet">
              <code>{freshSnippet}</code>
            </pre>
            <button
              type="button"
              className="api-keys__copy"
              onClick={() => void handleCopy()}
              aria-label="Copy silent alarm snippet"
            >
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
          {mcpSnippet ? (
            <pre className="canary-silent-alarm__snippet">
              <code>{mcpSnippet}</code>
            </pre>
          ) : null}
        </div>
      ) : null}

      {error ? (
        <p className="dashboard-public-connect__error" role="alert">
          {error}
        </p>
      ) : null}

      {hitTokens.length > 0 ? (
        <div className="canary-tokens__hits" role="status">
          <p className="canary-tokens__hits-title">Tripwire fetched</p>
          <p className="canary-tokens__hits-copy">{CANARY_HIT_ROTATE_COPY}</p>
          <ul className="canary-tokens__hits-list" aria-label="Canary hit history">
            {hitTokens.map((token) => (
              <li key={token.id} className="canary-tokens__hits-item">
                <span className="api-keys__item-label" title={token.label}>
                  {token.label}
                </span>
                <code className="api-keys__item-prefix">{token.tokenPrefix}…</code>
                <span className="canary-tokens__hits-meta">
                  {token.lastHitAt ? (
                    <>
                      Last hit{' '}
                      <time dateTime={token.lastHitAt} suppressHydrationWarning>
                        {formatApiKeyDay(token.lastHitAt)}
                      </time>
                      {token.hitCount > 1 ? ` · ${token.hitCount} hits` : null}
                    </>
                  ) : (
                    `${token.hitCount} hit${token.hitCount === 1 ? '' : 's'}`
                  )}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
