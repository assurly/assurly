'use client';

import { useCallback, useState, type FormEvent, type ReactElement } from 'react';
import { clientApi, type ApiKeySummary } from '../../../utils/clientApi';

/**
 * Programmatic API keys management (Phase 7). Issue a key for the MCP
 * `assurly_verdict` tool / the keyed `GET /api/v1/verdict` API, and revoke keys.
 *
 * The plaintext key is shown EXACTLY ONCE, on creation — it is never stored and
 * cannot be recovered. Data loads lazily on first expand so the surface adds no
 * work to the default dashboard render.
 */
export function ApiKeys(): ReactElement {
  const [loaded, setLoaded] = useState(false);
  const [keys, setKeys] = useState<ApiKeySummary[]>([]);
  const [label, setLabel] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [freshPlaintext, setFreshPlaintext] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const { keys: rows } = await clientApi.apiKeys.list();
      setKeys(rows);
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Could not load API keys.');
    } finally {
      setLoaded(true);
    }
  }, []);

  const handleToggle = (event: { currentTarget: HTMLDetailsElement }): void => {
    if (event.currentTarget.open && !loaded) void load();
  };

  const handleCreate = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (!label.trim()) return;
    setCreating(true);
    setError(null);
    setFreshPlaintext(null);
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
    <details className="api-keys" onToggle={handleToggle}>
      <summary className="api-keys__summary">API keys for agents &amp; OEM</summary>

      <p className="api-keys__copy">
        Issue a key so an AI agent can call the Assurly ship gate over MCP (
        <code>assurly_verdict</code>) or the <code>GET /api/v1/verdict</code> API before it deploys.
        Keys are read-only over your verdicts and never trigger a probe.
      </p>

      <form className="api-keys__form" onSubmit={(event) => void handleCreate(event)}>
        <input
          type="text"
          className="api-keys__input"
          placeholder="Key label (e.g. Cursor agent)"
          value={label}
          maxLength={120}
          onChange={(event) => setLabel(event.target.value)}
          aria-label="API key label"
        />
        <button type="submit" className="api-keys__create" disabled={creating || !label.trim()}>
          {creating ? 'Creating…' : 'Create key'}
        </button>
      </form>

      {freshPlaintext ? (
        <div className="api-keys__reveal" role="status">
          <p className="api-keys__reveal-title">Copy your key now — it will not be shown again.</p>
          <code className="api-keys__plaintext">{freshPlaintext}</code>
        </div>
      ) : null}

      {error ? (
        <p className="api-keys__error" role="alert">
          {error}
        </p>
      ) : null}

      {loaded && keys.length === 0 ? (
        <p className="api-keys__empty">No API keys yet.</p>
      ) : (
        <ul className="api-keys__list">
          {keys.map((key) => (
            <li key={key.id} className="api-keys__item">
              <span className="api-keys__item-label">
                {key.label} <code>{key.keyPrefix}…</code>
              </span>
              <span className="api-keys__item-meta">
                {key.plan}
                {key.revokedAt ? ' · revoked' : ''}
              </span>
              {key.revokedAt ? null : (
                <button
                  type="button"
                  className="api-keys__revoke"
                  onClick={() => void handleRevoke(key.id)}
                >
                  Revoke
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </details>
  );
}
