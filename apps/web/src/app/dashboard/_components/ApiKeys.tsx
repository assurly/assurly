'use client';

import { useCallback, useEffect, useState, type FormEvent, type ReactElement } from 'react';
import { useAccessibleMenu } from '../../../hooks/useAccessibleMenu';
import { clientApi, type ApiKeySummary } from '../../../utils/clientApi';
import { formatApiKeyMetadata } from '../../../utils/apiKeyDisplay';
import { apiKeyLabelLooksLikeSecret } from '../../../utils/apiKeyLabelSecret';

/**
 * Programmatic API keys management (Phase 7). Issue a key for the MCP
 * `assurly_verdict` tool / the keyed `GET /api/v1/verdict` API, and revoke keys.
 *
 * The plaintext key is shown EXACTLY ONCE, on creation — it is never stored and
 * cannot be recovered.
 *
 * Presented as a peer of the other "connect an app" cards in the repo column, so
 * it reuses the shared `dashboard-public-connect` card language for the frame,
 * title, copy, form, input, and submit; only the key-specific bits (the one-time
 * reveal and the key list) add their own `api-keys__*` styles.
 */
export function ApiKeys(): ReactElement {
  const [keys, setKeys] = useState<ApiKeySummary[]>([]);
  const [label, setLabel] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [freshPlaintext, setFreshPlaintext] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [confirmKey, setConfirmKey] = useState<ApiKeySummary | null>(null);

  const { menuRef: dialogRef, rememberTrigger } = useAccessibleMenu<HTMLDivElement>({
    open: confirmKey !== null,
    onClose: () => setConfirmKey(null),
  });

  const labelLooksLikeSecret = apiKeyLabelLooksLikeSecret(label);

  const load = useCallback(async () => {
    try {
      const { keys: rows } = await clientApi.apiKeys.list();
      setKeys(rows);
    } catch (loadError) {
      // A failed background list must not shout a page-level alert — leave the
      // list empty. Only user actions (create/revoke/delete) surface an error below.
      console.warn(
        '[Assurly] failed to load API keys:',
        loadError instanceof Error ? loadError.message : loadError,
      );
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- mount-time key list fetch
    void load();
  }, [load]);

  const activeKeys = keys.filter((key) => !key.revokedAt);
  const revokedKeys = keys.filter((key) => Boolean(key.revokedAt));

  const handleCreate = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (!label.trim()) return;
    setCreating(true);
    setError(null);
    setFreshPlaintext(null);
    setCopied(false);
    try {
      const { apiKey, key } = await clientApi.apiKeys.create(label.trim());
      setFreshPlaintext(apiKey);
      setKeys((current) => [key, ...current]);
      setLabel('');
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : 'Could not create the key.');
    } finally {
      setCreating(false);
    }
  };

  const handleCopy = async (): Promise<void> => {
    if (!freshPlaintext) return;
    try {
      await navigator.clipboard.writeText(freshPlaintext);
      setCopied(true);
    } catch {
      // Clipboard may be unavailable (insecure context) — the key stays visible to copy manually.
    }
  };

  const handleRevoke = async (id: string): Promise<void> => {
    setError(null);
    try {
      await clientApi.apiKeys.revoke(id);
      setKeys((current) =>
        current.map((key) =>
          key.id === id ? { ...key, revokedAt: new Date().toISOString() } : key,
        ),
      );
    } catch (revokeError) {
      setError(revokeError instanceof Error ? revokeError.message : 'Could not revoke the key.');
    }
  };

  const openConfirm = (key: ApiKeySummary, trigger: HTMLButtonElement): void => {
    rememberTrigger(trigger);
    setConfirmKey(key);
  };

  const confirmDelete = async (): Promise<void> => {
    if (!confirmKey) return;
    const target = confirmKey;
    const previous = keys;
    setConfirmKey(null);
    setError(null);
    // Optimistic removal — roll back if the server rejects the delete.
    setKeys((current) => current.filter((key) => key.id !== target.id));
    try {
      await clientApi.apiKeys.delete(target.id);
    } catch (deleteError) {
      setKeys(previous);
      setError(deleteError instanceof Error ? deleteError.message : 'Could not delete the key.');
    }
  };

  return (
    <section className="dashboard-public-connect api-keys" aria-label="API keys for agents and OEM">
      <h4 className="dashboard-public-connect__title">API keys for agents &amp; OEM</h4>
      <p className="dashboard-public-connect__copy">
        Issue a key so an AI agent can call the Assurly ship gate over MCP (
        <code>assurly_verdict</code>) or the <code>GET /api/v1/verdict</code> API before it deploys.
        Keys are read-only over your verdicts and never trigger a probe.
      </p>

      <form
        className="dashboard-public-connect__form"
        onSubmit={(event) => void handleCreate(event)}
      >
        <label className="visually-hidden" htmlFor="api-key-label">
          API key label
        </label>
        <input
          id="api-key-label"
          type="text"
          className="dashboard-public-connect__input"
          placeholder="Key label (e.g. Cursor agent)"
          value={label}
          maxLength={120}
          onChange={(event) => setLabel(event.target.value)}
          disabled={creating}
        />
        {labelLooksLikeSecret ? (
          <p className="api-keys__secret-warning" role="status">
            That looks like a secret. Labels are stored in plain text and shown in your dashboard —
            use a name like &lsquo;Cursor agent&rsquo; instead.
          </p>
        ) : null}
        <button
          type="submit"
          className="dashboard-public-connect__submit"
          disabled={creating || !label.trim()}
          aria-busy={creating}
        >
          {creating ? 'Creating…' : 'Create key'}
        </button>
      </form>

      {freshPlaintext ? (
        <div className="api-keys__reveal" role="status">
          <p className="api-keys__reveal-title">Copy your key now — it won’t be shown again.</p>
          <div className="api-keys__reveal-row">
            <code className="api-keys__plaintext">{freshPlaintext}</code>
            <button
              type="button"
              className="api-keys__copy"
              onClick={() => void handleCopy()}
              aria-label="Copy API key to clipboard"
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

      {activeKeys.length === 0 ? (
        <p className="api-keys__empty">
          {keys.length === 0 ? 'No API keys yet.' : 'No active API keys.'}
        </p>
      ) : (
        <ul className="api-keys__list" aria-label="Active API keys">
          {activeKeys.map((key) => (
            <ApiKeyRow key={key.id} apiKey={key} onRevoke={() => void handleRevoke(key.id)} />
          ))}
        </ul>
      )}

      {revokedKeys.length > 0 ? (
        <details className="api-keys__revoked">
          <summary className="api-keys__revoked-summary">
            Revoked keys ({revokedKeys.length})
          </summary>
          <ul className="api-keys__list api-keys__list--revoked" aria-label="Revoked API keys">
            {revokedKeys.map((key) => (
              <ApiKeyRow
                key={key.id}
                apiKey={key}
                onDelete={(trigger) => openConfirm(key, trigger)}
              />
            ))}
          </ul>
        </details>
      ) : null}

      {confirmKey ? (
        <div
          className="scan-delete-dialog__backdrop"
          data-testid="api-key-delete-dialog"
          onClick={() => setConfirmKey(null)}
        >
          <div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="api-key-delete-dialog-title"
            aria-describedby="api-key-delete-dialog-desc"
            className="scan-delete-dialog"
            onClick={(event) => event.stopPropagation()}
          >
            <h4 id="api-key-delete-dialog-title" className="scan-delete-dialog__title">
              Delete API key?
            </h4>
            <p id="api-key-delete-dialog-desc" className="scan-delete-dialog__desc">
              Permanently delete the revoked key &ldquo;{confirmKey.label}&rdquo; (
              {confirmKey.keyPrefix}…)? This cannot be undone.
            </p>
            <div className="scan-delete-dialog__actions">
              <button
                type="button"
                className="scan-delete-dialog__cancel"
                onClick={() => setConfirmKey(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="scan-delete-dialog__confirm"
                onClick={() => void confirmDelete()}
              >
                Delete key
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}

interface ApiKeyRowProps {
  apiKey: ApiKeySummary;
  onRevoke?: () => void;
  onDelete?: (trigger: HTMLButtonElement) => void;
}

function ApiKeyRow({ apiKey, onRevoke, onDelete }: ApiKeyRowProps): ReactElement {
  const revoked = Boolean(apiKey.revokedAt);
  const meta = formatApiKeyMetadata({
    createdAt: apiKey.createdAt,
    lastUsedAt: apiKey.lastUsedAt,
    revokedAt: apiKey.revokedAt,
  });

  return (
    <li className={`api-keys__item${revoked ? ' api-keys__item--revoked' : ''}`}>
      <div className="api-keys__item-body">
        <div className="api-keys__item-main">
          <span className="api-keys__item-label" title={apiKey.label}>
            {apiKey.label}
          </span>
          <code className="api-keys__item-prefix">{apiKey.keyPrefix}…</code>
        </div>
        <p className="api-keys__item-meta">
          <time
            dateTime={apiKey.revokedAt ?? apiKey.lastUsedAt ?? apiKey.createdAt}
            suppressHydrationWarning
          >
            {meta}
          </time>
        </p>
      </div>
      <div className="api-keys__item-side">
        <span className="api-keys__badge">{apiKey.plan}</span>
        {revoked ? (
          <>
            <span className="api-keys__revoked-tag">Revoked</span>
            {onDelete ? (
              <button
                type="button"
                className="api-keys__delete"
                data-testid={`api-key-delete-${apiKey.id}`}
                aria-label={`Delete revoked key ${apiKey.label}`}
                onClick={(event) => onDelete(event.currentTarget)}
              >
                <span aria-hidden="true">×</span>
              </button>
            ) : null}
          </>
        ) : (
          <button type="button" className="api-keys__revoke" onClick={onRevoke}>
            Revoke
          </button>
        )}
      </div>
    </li>
  );
}
