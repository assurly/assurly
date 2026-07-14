'use client';

import type { ReactElement } from 'react';
import type { ShipGateGroup } from '../../../utils/shipGate';
import { consequenceForGroupKey } from '../../../utils/consequenceMap';
import { ShipGateGroupAction } from './ShipGateGroupAction';

interface ShipGateGroupRowProps {
  group: ShipGateGroup;
  fileSuffix: string;
}

export function ShipGateGroupRow({ group, fileSuffix }: ShipGateGroupRowProps): ReactElement {
  const consequence = consequenceForGroupKey(group.id);
  return (
    <li className="ship-gate-list-item">
      <div className="ship-gate-list-main">
        <span className="ship-gate-list-label">{group.label}</span>
        <span className="ship-gate-list-meta">{fileSuffix}</span>
      </div>
      {consequence ? <p className="ship-gate-list-consequence">{consequence.consequence}</p> : null}
      {group.action ? <ShipGateGroupAction action={group.action} /> : null}
    </li>
  );
}
