import type { Target } from './dbAdapter';

/**
 * URL targets that belong on the "Your apps" dashboard.
 *
 * One-off URL probes must never create a target row — only an explicit
 * "Guard this URL" (`POST /api/targets`) does. Once that row exists it is
 * listed immediately (pending ownership verification). Continuous Guardian /
 * active probe still require `ownership_verified`.
 *
 * Connected GitHub repos are always listed — ownership is implicit via the App.
 * Pre-P0 auto-upserted probe noise is wiped by
 * `20260730100000_targets_delete_and_probe_cleanup.sql`.
 */
export function isListedUrlTarget(target: Target): boolean {
  return target.kind === 'url';
}

/**
 * Counts apps that consume the plan's guarded-app entitlement.
 *
 * - Every connected repository counts (one slot each).
 * - Every `url` target counts — after one-off scans stop auto-creating rows,
 *   a `url` target exists only because the user asked to guard that origin.
 */
export function countGuardedApps(options: {
  repositoryCount: number;
  urlTargetCount: number;
}): number {
  return options.repositoryCount + options.urlTargetCount;
}
