'use client';

import type { ReactElement } from 'react';

export function ScanDetailsSkeleton(): ReactElement {
  return (
    <div
      className="scan-details-skeleton"
      data-testid="scan-details-skeleton"
      aria-busy="true"
      aria-label="Loading scan details"
    >
      <div className="scan-details-skeleton__history scan-history">
        <span className="scan-details-skeleton__line scan-details-skeleton__line--title" />
        <div className="scan-history-rail scan-details-skeleton__rail" aria-hidden="true">
          <span className="scan-details-skeleton__chip" />
          <span className="scan-details-skeleton__chip" />
          <span className="scan-details-skeleton__chip" />
        </div>
      </div>

      <div className="scan-details-skeleton__panel">
        <span className="scan-details-skeleton__line scan-details-skeleton__line--eyebrow" />
        <div className="scan-details-skeleton__header">
          <span className="scan-details-skeleton__line scan-details-skeleton__line--headline" />
          <span className="scan-details-skeleton__line scan-details-skeleton__line--score" />
        </div>
        <div className="scan-details-skeleton__rows">
          <span className="scan-details-skeleton__line scan-details-skeleton__line--row" />
          <span className="scan-details-skeleton__line scan-details-skeleton__line--row" />
          <span className="scan-details-skeleton__line scan-details-skeleton__line--row-short" />
        </div>
      </div>
    </div>
  );
}
