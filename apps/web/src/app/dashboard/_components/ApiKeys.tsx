'use client';

import { useCallback, useEffect, useState, type FormEvent, type ReactElement } from 'react';
import { clientApi, type ApiKeySummary } from '../../../utils/clientApi';

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

  const load = useCallback(async () => {
    try {
      const { keys: rows } = await clientApi.apiKeys.list();
      setKeys(rows);
    } catch (loadError) {
      // A failed background list must not shout a page-level alert — leave the
      // list empty. Only user actions (create/revoke) surface an error below.
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

      {keys.length === 0 ? (
        <p className="api-keys__empty">No API keys yet.</p>
      ) : (
        <ul className="api-keys__list">
          {keys.map((key) => {
            const revoked = Boolean(key.revokedAt);
            return (
              <li
                key={key.id}
                className={`api-keys__item${revoked ? ' api-keys__item--revoked' : ''}`}
              >
                <div className="api-keys__item-main">
                  <span className="api-keys__item-label">{key.label}</span>
                  <code className="api-keys__item-prefix">{key.keyPrefix}…</code>
                </div>
                <div className="api-keys__item-side">
                  <span className="api-keys__badge">{key.plan}</span>
                  {revoked ? (
                    <span className="api-keys__revoked-tag">Revoked</span>
                  ) : (
                    <button
                      type="button"
                      className="api-keys__revoke"
                      onClick={() => void handleRevoke(key.id)}
                    >
                      Revoke
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
