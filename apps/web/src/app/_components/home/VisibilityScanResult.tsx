'use client';

import type { ReactElement, ReactNode } from 'react';
import {
  VisibilityAuditPanel,
  type VisibilityHeadline,
  type VisibilityView,
} from '../../dashboard/_components/VisibilityAuditPanel';

export type { VisibilityHeadline, VisibilityView };

const VISIBILITY_VERDICTS = new Set(['visible', 'partial', 'invisible']);

/** Narrow an unknown API field to a headline — rejects incomplete payloads. */
export function isVisibilityHeadline(value: unknown): value is VisibilityHeadline {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.score === 'number' &&
    typeof record.aiReadinessScore === 'number' &&
    typeof record.searchReadinessScore === 'number' &&
    typeof record.verdict === 'string' &&
    VISIBILITY_VERDICTS.has(record.verdict)
  );
}

interface VisibilityScanResultProps {
  /** Headline (or entitled view) from `/api/scan-url`. Absent → render nothing. */
  report: VisibilityView | null | undefined;
  locked?: boolean;
  lockedHint?: ReactNode;
}

/**
 * Landing-page surface for the live URL-scan SEO & GEO headline.
 *
 * Reuses VisibilityAuditPanel (same vocabulary as the dashboard). When the
 * payload is missing — older responses or a skipped audit — renders nothing:
 * no placeholder, no zero, no "N/A".
 */
export function VisibilityScanResult({
  report,
  locked = false,
  lockedHint,
}: VisibilityScanResultProps): ReactElement | null {
  if (!report) return null;

  return <VisibilityAuditPanel report={report} locked={locked} lockedHint={lockedHint} />;
}
