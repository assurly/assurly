/**
 * Captured registry metadata for `react-codeshift` — the Phase 3 slopsquat
 * acceptance fixture. Source: https://registry.npmjs.org/react-codeshift
 * Captured: 2026-07-26T07:38:24.314Z
 *
 * Real shape (defensive placeholder, identical to a malicious pre-registration):
 *   versions: 1 (1.0.0), created == modified
 *   repository: absent
 *   description: "🚫 Placeholder to prevent dependency confusion."
 *   maintainers: 1
 *
 * Weekly downloads are recorded separately from the downloads API at capture
 * time (1). The full registry JSON lives alongside this file for audit.
 */
import type { DependencyProvenanceSignals } from '../dependencyProvenance';

export const REACT_CODESHIFT_FIXTURE_CAPTURED_AT = '2026-07-26T07:38:24.314Z';

/** Provenance signals derived from the captured registry document + downloads. */
export const REACT_CODESHIFT_SIGNALS: DependencyProvenanceSignals = {
  packageName: 'react-codeshift',
  file: 'package.json',
  exists: true,
  // Created 2026-01-14 — well past the 30-day window. Age must not matter.
  ageDays: 192,
  weeklyDownloads: 1,
  versionCount: 1,
  hasRepository: false,
};
