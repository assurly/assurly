'use client';

import { useCallback, useEffect, useState, type FormEvent, type ReactElement } from 'react';
import { formatCount } from '../../../utils/pluralize';

export interface AlertPreferencesProps {
  targetId: string;
}

interface PrefRow {
  id: string;
  channel: 'email' | 'slack' | 'discord';
  webhookUrl: string | null;
  enabled: boolean;
}

/**
 * Per-target alert preferences for the Continuous Guardian (Phase 6).
 * Email stays on by default; Slack/Discord are optional incoming webhooks.
 */
export function AlertPreferences({ targetId }: AlertPreferencesProps): ReactElement {
  const [prefs, setPrefs] = useState<PrefRow[]>([]);
  const [emailEnabled, setEmailEnabled] = useState(true);
  const [slackEnabled, setSlackEnabled] = useState(false);
  const [slackUrl, setSlackUrl] = useState('');
  const [discordEnabled, setDiscordEnabled] = useState(false);
  const [discordUrl, setDiscordUrl] = useState('');
  const [status, setStatus] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const response = await fetch(`/api/targets/${targetId}/alert-prefs`, {
      credentials: 'same-origin',
    });
    if (!response.ok) return;
    const data = (await response.json()) as { prefs: PrefRow[] };
    setPrefs(data.prefs);
    const email = data.prefs.find((pref) => pref.channel === 'email');
    const slack = data.prefs.find((pref) => pref.channel === 'slack');
    const discord = data.prefs.find((pref) => pref.channel === 'discord');
    setEmailEnabled(email?.enabled ?? true);
    setSlackEnabled(slack?.enabled ?? false);
    setSlackUrl(slack?.webhookUrl ?? '');
    setDiscordEnabled(discord?.enabled ?? false);
    setDiscordUrl(discord?.webhookUrl ?? '');
  }, [targetId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- mount-time prefs fetch
    void load();
  }, [load]);

  const saveChannel = async (
    channel: 'email' | 'slack' | 'discord',
    enabled: boolean,
    webhookUrl: string | null,
  ): Promise<void> => {
    const response = await fetch(`/api/targets/${targetId}/alert-prefs`, {
      method: 'PUT',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ channel, enabled, webhookUrl }),
    });
    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as {
        error?: { message?: string };
      } | null;
      throw new Error(payload?.error?.message ?? 'Could not save alert preferences.');
    }
  };

  const handleSubmit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setSaving(true);
    setStatus(null);
    try {
      await saveChannel('email', emailEnabled, null);
      await saveChannel('slack', slackEnabled, slackUrl.trim() || null);
      await saveChannel('discord', discordEnabled, discordUrl.trim() || null);
      setStatus('Alert preferences saved.');
      await load();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Save failed.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <form className="alert-prefs" onSubmit={(event) => void handleSubmit(event)}>
      <h4 className="alert-prefs__title">Guardian alerts</h4>
      <p className="alert-prefs__copy">
        We only email or ping you when a <strong>new blocker</strong> appears — never on the steady
        state.
      </p>

      <label className="alert-prefs__row">
        <input
          type="checkbox"
          checked={emailEnabled}
          onChange={(event) => setEmailEnabled(event.target.checked)}
        />
        Email (Resend — org admins)
      </label>

      <label className="alert-prefs__row">
        <input
          type="checkbox"
          checked={slackEnabled}
          onChange={(event) => setSlackEnabled(event.target.checked)}
        />
        Slack incoming webhook
      </label>
      {slackEnabled ? (
        <input
          type="url"
          className="alert-prefs__input"
          placeholder="https://hooks.slack.com/services/…"
          value={slackUrl}
          onChange={(event) => setSlackUrl(event.target.value)}
        />
      ) : null}

      <label className="alert-prefs__row">
        <input
          type="checkbox"
          checked={discordEnabled}
          onChange={(event) => setDiscordEnabled(event.target.checked)}
        />
        Discord incoming webhook
      </label>
      {discordEnabled ? (
        <input
          type="url"
          className="alert-prefs__input"
          placeholder="https://discord.com/api/webhooks/…"
          value={discordUrl}
          onChange={(event) => setDiscordUrl(event.target.value)}
        />
      ) : null}

      <button type="submit" className="alert-prefs__submit" disabled={saving}>
        {saving ? 'Saving…' : 'Save alert preferences'}
      </button>
      {status ? (
        <p className="alert-prefs__status" role="status">
          {status}
        </p>
      ) : null}
      {prefs.length === 0 ? null : (
        <p className="alert-prefs__hint" aria-hidden="true">
          {formatCount(prefs.filter((pref) => pref.enabled).length, 'channel')} configured.
        </p>
      )}
    </form>
  );
}
