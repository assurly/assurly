'use client';

import { useId, type ReactElement } from 'react';
import type { ShipGateAction } from '../../../utils/shipGate';
import { CopyButton } from './CopyButton';

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
            <CopyButton value={action.command ?? ''} label="Copy command" />
          </div>
        </div>
      );
    case 'link': {
      if (!action.href) return null;
      const isInPage = action.href.startsWith('#');
      return (
        <div className="ship-gate-list-action">
          <a
            href={action.href}
            className="ship-gate-action-link"
            {...(isInPage ? {} : { target: '_blank', rel: 'noopener noreferrer' })}
          >
            {action.label}
          </a>
        </div>
      );
    }
    case 'hint': {
      const hintText = action.hint ?? action.label;
      return (
        <div className="ship-gate-list-action ship-gate-list-action--hint">
          <p className="ship-gate-action-label">{action.label}</p>
          <div className="ship-gate-action-hint-row">
            <p className="ship-gate-action-hint">{hintText}</p>
            <CopyButton value={hintText} label="Copy fix" />
          </div>
        </div>
      );
    }
    default: {
      const neverKind: never = action.kind;
      return neverKind;
    }
  }
}
