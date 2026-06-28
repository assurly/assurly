'use client';

import { useId, type ReactElement } from 'react';
import type { ShipGateAction } from '../../../utils/shipGate';

interface ShipGateGroupActionProps {
  action: ShipGateAction;
}

export function ShipGateGroupAction({ action }: ShipGateGroupActionProps): ReactElement | null {
  const labelId = useId();

  switch (action.kind) {
    case 'command':
      if (!action.command) return null;
      return (
        <div className="ship-gate-list-action ship-gate-list-action--command">
          <p id={labelId} className="ship-gate-action-label">
            {action.label}
          </p>
          <div className="ship-gate-action-row" aria-labelledby={labelId}>
            <code className="ship-gate-action-command">{action.command}</code>
            <button
              type="button"
              className="ship-gate-action-copy"
              onClick={() => void navigator.clipboard.writeText(action.command ?? '')}
            >
              Copy command
            </button>
          </div>
        </div>
      );
    case 'link':
      if (!action.href) return null;
      return (
        <div className="ship-gate-list-action">
          <a
            href={action.href}
            className="ship-gate-action-link"
            target="_blank"
            rel="noopener noreferrer"
          >
            {action.label}
          </a>
        </div>
      );
    case 'hint':
      return (
        <div className="ship-gate-list-action ship-gate-list-action--hint">
          <p className="ship-gate-action-label">{action.label}</p>
          <p className="ship-gate-action-hint">{action.hint ?? action.label}</p>
        </div>
      );
    default: {
      const neverKind: never = action.kind;
      return neverKind;
    }
  }
}
