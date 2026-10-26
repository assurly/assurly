'use client';

import { useEffect, useId, useState, type ChangeEvent, type ReactElement } from 'react';
import { clientApi, type WorkspaceChoice } from '../../../utils/clientApi';

export interface WorkspaceChoices {
  workspaces: WorkspaceChoice[];
  activeId: string | null;
}

/** The person's workspaces, the active one first. Empty until loaded or on failure. */
export function useWorkspaceChoices(): WorkspaceChoices {
  const [choices, setChoices] = useState<WorkspaceChoices>({ workspaces: [], activeId: null });
  useEffect(() => {
    let cancelled = false;
    clientApi.workspaces
      .list()
      .then((result) => {
        if (!cancelled) setChoices({ workspaces: result.organizations, activeId: result.activeId });
      })
      // Without the list there is nothing to switch to; the header still works.
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);
  return choices;
}

/**
 * Switches between workspaces when the person belongs to more than one, for
 * example their own and a Vercel team's from "Open in Assurly". Renders
 * nothing for the usual single workspace. A switch reloads the dashboard, so
 * every panel reads the new workspace from the server.
 */
export function WorkspaceSwitcher({ workspaces, activeId }: WorkspaceChoices): ReactElement | null {
  const selectId = useId();
  /** The workspace being switched to; null while the active one is shown. */
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (workspaces.length < 2 || !activeId) return null;

  async function handleChange(event: ChangeEvent<HTMLSelectElement>): Promise<void> {
    const next = event.target.value;
    if (next === activeId) return;
    setPending(next);
    setError(null);
    try {
      await clientApi.workspaces.select(next);
      // A full load: the dashboard keeps the workspace in client state.
      window.location.reload();
    } catch {
      setPending(null);
      setError('Could not switch workspace. Try again.');
    }
  }

  return (
    <div className="dashboard-workspace__switcher">
      <label htmlFor={selectId} className="dashboard-workspace__switcher-label">
        Switch workspace
      </label>
      <select
        id={selectId}
        className="dashboard-workspace__switcher-select"
        value={pending ?? activeId}
        disabled={pending !== null}
        onChange={(event) => void handleChange(event)}
      >
        {workspaces.map((workspace) => (
          <option key={workspace.id} value={workspace.id}>
            {workspace.name}
          </option>
        ))}
      </select>
      {error ? (
        <p className="dashboard-workspace__switcher-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
