'use client';

import {
  useCallback,
  useEffect,
  useState,
  type FormEvent,
  type ReactElement,
  type ReactNode,
} from 'react';
import { useAccessibleMenu } from '../../../hooks/useAccessibleMenu';
import { ClientApiError, clientApi, type CanaryTokenSummary } from '../../../utils/clientApi';
import { CANARY_HIT_ROTATE_COPY } from '../../../utils/canaryPlant';
import { formatApiKeyDay, formatApiKeyMetadata } from '../../../utils/apiKeyDisplay';

export interface CanaryTokensProps {
  targetId: string;
}

/**
 * The panel shell carrying an explanation instead of controls.
 *
 * Canaries hang off a target, and a caller may not have one — because the
 * repository has not been scanned yet, or because its targets are still
 * loading, or because that lookup failed. Those are three different facts and
 * each deserves a different sentence. Rendering nothing conflated them with
 * "this feature does not exist", which is how the panel was reported missing.
 *
 * Callers pick the sentence; the shell stays here so the heading, framing and
 * classes cannot drift from the live panel below.
 */
export function CanaryTokensNotice({
  children,
  ariaLabel = 'Canary tokens',
}: {
  children: ReactNode;
  ariaLabel?: string;
}): ReactElement {
  return (
    <section className="dashboard-public-connect api-keys canary-tokens" aria-label={ariaLabel}>
      <h4 className="dashboard-public-connect__title">
        {ariaLabel === 'Silent alarm' ? 'Add a silent alarm' : 'Canary tokens'}
      </h4>
      <p className="dashboard-public-connect__copy">{children}</p>
    </section>
  );
}

/**
 * Canary token management for an ownership-gated target (Phase 3).
 *
 * A canary is a fake credential you plant in your own systems. If anyone ever
 * uses it, Assurly records a hit — evidence of exposure, not proof of who.
 *
 * Visual language matches `ApiKeys`: one-time plaintext reveal, copy, live /
 * revoked lists, revoke confirmation, and hard-delete of revoked rows via ×.
 * Reuses `api-keys__*` classes so the two surfaces stay visually identical.
 */
export function CanaryTokens({ targetId }: CanaryTokensProps): ReactElement {
  const [tokens, setTokens] = useState<CanaryTokenSummary[]>([]);
  const [label, setLabel] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [freshSnippet, setFreshSnippet] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [confirmRevoke, setConfirmRevoke] = useState<CanaryTokenSummary | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<CanaryTokenSummary | null>(null);
  const [ownershipBlocked, setOwnershipBlocked] = useState(false);

  const { menuRef: revokeDialogRef, rememberTrigger: rememberRevokeTrigger } =
    useAccessibleMenu<HTMLDivElement>({
      open: confirmRevoke !== null,
      onClose: () => setConfirmRevoke(null),
    });

  const { menuRef: deleteDialogRef, rememberTrigger: rememberDeleteTrigger } =
    useAccessibleMenu<HTMLDivElement>({
      open: confirmDelete !== null,
      onClose: () => setConfirmDelete(null),
    });

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
        '[Assurly] failed to load canary tokens:',
        loadError instanceof Error ? loadError.message : loadError,
      );
    }
  }, [targetId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- mount-time / target change fetch
    void load();
  }, [load]);

  const activeTokens = tokens.filter((token) => !token.revokedAt);
  const revokedTokens = tokens.filter((token) => Boolean(token.revokedAt));
  const hitTokens = tokens.filter((token) => token.lastHitAt !== null || token.hitCount > 0);

  const handleCreate = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setCreating(true);
    setError(null);
    setFreshSnippet(null);
    setCopied(false);
    try {
      const created = await clientApi.canary.issue(targetId, label.trim() || undefined);
      setFreshSnippet(created.snippet);
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
      setLabel('');
      setOwnershipBlocked(false);
    } catch (createError) {
      if (createError instanceof ClientApiError && createError.code === 'ownership_required') {
        setOwnershipBlocked(true);
      }
      setError(
        createError instanceof Error ? createError.message : 'Could not issue the canary token.',
      );
    } finally {
      setCreating(false);
    }
  };

  const handleCopy = async (): Promise<void> => {
    if (!freshSnippet) return;
    try {
      await navigator.clipboard.writeText(freshSnippet);
      setCopied(true);
    } catch {
      // Clipboard may be unavailable — the token stays visible to copy manually.
    }
  };

  const openRevokeConfirm = (token: CanaryTokenSummary, trigger: HTMLButtonElement): void => {
    rememberRevokeTrigger(trigger);
    setConfirmRevoke(token);
  };

  const openDeleteConfirm = (token: CanaryTokenSummary, trigger: HTMLButtonElement): void => {
    rememberDeleteTrigger(trigger);
    setConfirmDelete(token);
  };

  const confirmRevokeAction = async (): Promise<void> => {
    if (!confirmRevoke) return;
    const target = confirmRevoke;
    setConfirmRevoke(null);
    setError(null);
    try {
      await clientApi.canary.revoke(targetId, target.id);
      setTokens((current) =>
        current.map((token) =>
          token.id === target.id ? { ...token, revokedAt: new Date().toISOString() } : token,
        ),
      );
    } catch (revokeError) {
      setError(
        revokeError instanceof Error ? revokeError.message : 'Could not revoke the canary token.',
      );
    }
  };

  const confirmDeleteAction = async (): Promise<void> => {
    if (!confirmDelete) return;
    const target = confirmDelete;
    const previous = tokens;
    setConfirmDelete(null);
    setError(null);
    // Optimistic removal — roll back if the server rejects the delete.
    setTokens((current) => current.filter((token) => token.id !== target.id));
    try {
      await clientApi.canary.delete(targetId, target.id);
    } catch (deleteError) {
      setTokens(previous);
      setError(
        deleteError instanceof Error ? deleteError.message : 'Could not delete the canary token.',
      );
    }
  };

  if (ownershipBlocked) {
    return (
      <CanaryTokensNotice>
        Verify ownership of this app first. Canary tokens are fake credentials you plant in your own
        systems — Assurly alerts if anyone ever uses one.
      </CanaryTokensNotice>
    );
  }

  return (
    <section className="dashboard-public-connect api-keys canary-tokens" aria-label="Canary tokens">
      <h4 className="dashboard-public-connect__title">Canary tokens</h4>
      <p className="dashboard-public-connect__copy">
        A canary is a tripwire URL you plant in .env.example as ASSURLY_CANARY_URL. If anyone
        fetches it, Assurly records a hit. That is evidence the env was exposed, not proof of who
        used it. Issue, revoke, and delete live here; the app workspace has a one-click silent
        alarm.
      </p>

      <form
        className="dashboard-public-connect__form"
        onSubmit={(event) => void handleCreate(event)}
      >
        <label className="visually-hidden" htmlFor={`canary-label-${targetId}`}>
          Canary token label
        </label>
        <input
          id={`canary-label-${targetId}`}
          type="text"
          className="dashboard-public-connect__input"
          placeholder="Label (e.g. Staging env decoy)"
          value={label}
          maxLength={120}
          onChange={(event) => setLabel(event.target.value)}
          disabled={creating}
        />
        <button
          type="submit"
          className="dashboard-public-connect__submit"
          disabled={creating}
          aria-busy={creating}
        >
          {creating ? 'Issuing…' : 'Issue canary'}
        </button>
      </form>

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
              aria-label="Copy canary snippet to clipboard"
            >
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
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

      {activeTokens.length === 0 ? (
        <p className="api-keys__empty">
          {tokens.length === 0 ? 'No canary tokens yet.' : 'No active canary tokens.'}
        </p>
      ) : (
        <ul className="api-keys__list" aria-label="Active canary tokens">
          {activeTokens.map((token) => (
            <CanaryTokenRow
              key={token.id}
              token={token}
              onRevoke={(trigger) => openRevokeConfirm(token, trigger)}
            />
          ))}
        </ul>
      )}

      {revokedTokens.length > 0 ? (
        <details className="api-keys__revoked">
          <summary className="api-keys__revoked-summary">
            Revoked canaries ({revokedTokens.length})
          </summary>
          <ul className="api-keys__list api-keys__list--revoked" aria-label="Revoked canary tokens">
            {revokedTokens.map((token) => (
              <CanaryTokenRow
                key={token.id}
                token={token}
                onDelete={(trigger) => openDeleteConfirm(token, trigger)}
              />
            ))}
          </ul>
        </details>
      ) : null}

      {confirmRevoke ? (
        <div
          className="scan-delete-dialog__backdrop"
          data-testid="canary-revoke-dialog"
          onClick={() => setConfirmRevoke(null)}
        >
          <div
            ref={revokeDialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="canary-revoke-dialog-title"
            aria-describedby="canary-revoke-dialog-desc"
            className="scan-delete-dialog"
            onClick={(event) => event.stopPropagation()}
          >
            <h4 id="canary-revoke-dialog-title" className="scan-delete-dialog__title">
              Revoke canary token?
            </h4>
            <p id="canary-revoke-dialog-desc" className="scan-delete-dialog__desc">
              Revoke &ldquo;{confirmRevoke.label}&rdquo; ({confirmRevoke.tokenPrefix}…)? Further
              uses will no longer count as hits. The audit trail is kept.
            </p>
            <div className="scan-delete-dialog__actions">
              <button
                type="button"
                className="scan-delete-dialog__cancel"
                onClick={() => setConfirmRevoke(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="scan-delete-dialog__confirm"
                onClick={() => void confirmRevokeAction()}
              >
                Revoke canary
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {confirmDelete ? (
        <div
          className="scan-delete-dialog__backdrop"
          data-testid="canary-delete-dialog"
          onClick={() => setConfirmDelete(null)}
        >
          <div
            ref={deleteDialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="canary-delete-dialog-title"
            aria-describedby="canary-delete-dialog-desc"
            className="scan-delete-dialog"
            onClick={(event) => event.stopPropagation()}
          >
            <h4 id="canary-delete-dialog-title" className="scan-delete-dialog__title">
              Delete canary token?
            </h4>
            <p id="canary-delete-dialog-desc" className="scan-delete-dialog__desc">
              Permanently delete the revoked canary &ldquo;{confirmDelete.label}&rdquo; (
              {confirmDelete.tokenPrefix}…)? This cannot be undone.
            </p>
            <div className="scan-delete-dialog__actions">
              <button
                type="button"
                className="scan-delete-dialog__cancel"
                onClick={() => setConfirmDelete(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="scan-delete-dialog__confirm"
                onClick={() => void confirmDeleteAction()}
              >
                Delete canary
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}

interface CanaryTokenRowProps {
  token: CanaryTokenSummary;
  onRevoke?: (trigger: HTMLButtonElement) => void;
  onDelete?: (trigger: HTMLButtonElement) => void;
}

function CanaryTokenRow({ token, onRevoke, onDelete }: CanaryTokenRowProps): ReactElement {
  const revoked = Boolean(token.revokedAt);
  const meta = formatApiKeyMetadata({
    createdAt: token.createdAt,
    lastUsedAt: token.lastHitAt,
    revokedAt: token.revokedAt,
  });

  return (
    <li className={`api-keys__item${revoked ? ' api-keys__item--revoked' : ''}`}>
      <div className="api-keys__item-body">
        <div className="api-keys__item-main">
          <span className="api-keys__item-label" title={token.label}>
            {token.label}
          </span>
          <code className="api-keys__item-prefix">{token.tokenPrefix}…</code>
        </div>
        <p className="api-keys__item-meta">
          <time
            dateTime={token.revokedAt ?? token.lastHitAt ?? token.createdAt}
            suppressHydrationWarning
          >
            {meta}
          </time>
        </p>
      </div>
      <div className="api-keys__item-side">
        {revoked ? (
          <>
            <span className="api-keys__revoked-tag">Revoked</span>
            {onDelete ? (
              <button
                type="button"
                className="api-keys__delete"
                data-testid={`canary-delete-${token.id}`}
                aria-label={`Delete revoked canary ${token.label}`}
                onClick={(event) => onDelete(event.currentTarget)}
              >
                <span aria-hidden="true">×</span>
              </button>
            ) : null}
          </>
        ) : (
          <button
            type="button"
            className="api-keys__revoke"
            aria-label={`Revoke canary ${token.label}`}
            onClick={(event) => onRevoke?.(event.currentTarget)}
          >
            Revoke
          </button>
        )}
      </div>
    </li>
  );
}
