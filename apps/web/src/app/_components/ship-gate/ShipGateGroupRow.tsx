'use client';

import type { ReactElement } from 'react';
import type { ShipGateGroup } from '../../../utils/shipGate';
import { ShipGateGroupAction } from './ShipGateGroupAction';

interface ShipGateGroupRowProps {
  group: ShipGateGroup;
  fileSuffix: string;
}

export function ShipGateGroupRow({ group, fileSuffix }: ShipGateGroupRowProps): ReactElement {
  return (
    <li className="ship-gate-list-item">
      <div className="ship-gate-list-main">
        <span className="ship-gate-list-label">{group.label}</span>
        <span className="ship-gate-list-meta">{fileSuffix}</span>
      </div>
      {group.action ? <ShipGateGroupAction action={group.action} /> : null}
    </li>
  );
}
