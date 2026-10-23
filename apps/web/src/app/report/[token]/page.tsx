import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import type { ReactElement } from 'react';
import { ShipGatePanel } from '../../_components/ship-gate/ShipGatePanel';
import { ThemeToggle } from '../../_components/ThemeToggle';
import { isIssueFinding } from '@assurly/scanner-core';
import { buildShipGateFromScanFindings } from '../../../utils/shipGate';
import { getAdminDbAdapter } from '../../../utils/dbAdapter';
import { toPublicTrustProjection } from '../../../utils/publicTrust';
import { formatScanDateTime } from '../../../utils/scanHistoryDisplay';
import { resolveScanFreshness, resolveTargetFreshness } from '../../../utils/targetFreshness';
import { freshnessNote, type VerdictFreshness } from '../../../utils/verdictFreshness';

interface ReportPageProps {
  params: Promise<{ token: string }>;
}

/**
 * A shared report is reachable by anyone holding the token — that is the point — but it
 * names a customer's repository and lists their unfixed security findings. Letting a
 * crawler index one would put a customer's weaknesses into public search results, so
 * these pages are kept out of every index regardless of where the link ends up.
 */
export const metadata: Metadata = {
  robots: { index: false, follow: false, nocache: true },
};

const VERDICT_LABEL: Record<string, string> = {
  ready: 'Ready to ship',
  review: 'Review recommended',
  blocked: 'Not ready to ship',
  unknown: 'Not checked yet',
};

function formatFreshness(iso: string | null): string {
  if (!iso) return 'Never checked';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return 'Never checked';
  const seconds = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (seconds < 60) return 'Checked just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `Checked ${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `Checked ${hours}h ago`;
  const days = Math.round(hours / 24);
  return `Checked ${days}d ago`;
}

/**
 * The verdict wording for a public page. An out-of-date "ready" is reported as
 * history ("Ready 128 days ago"), never as the app's current state.
 */
function publicVerdictLabel(verdict: string, freshness: VerdictFreshness): string {
  if (verdict === 'ready' && freshness.status === 'code_changed') return 'Ready at an older commit';
  if (verdict === 'ready' && freshness.status === 'old' && freshness.daysOld !== null) {
    return `Ready ${freshness.daysOld} ${freshness.daysOld === 1 ? 'day' : 'days'} ago`;
  }
  return VERDICT_LABEL[verdict] ?? verdict;
}

function StaleNotice({ freshness }: { freshness: VerdictFreshness }): ReactElement | null {
  const note = freshnessNote(freshness);
  if (!note) return null;
  return (
    <p className="report-page-stale" role="status" data-testid="report-stale-notice">
      {note}
    </p>
  );
}

/**
 * Public trust page (Phase 6 growth loop) when the token is a target badge_token.
 * Falls back to the legacy scan share report for backward compatibility.
 * Trust projection is shape-only — never evidence rows / PII.
 */
export default async function ReportPage({ params }: ReportPageProps): Promise<ReactElement> {
  const { token } = await params;
  if (!/^[a-f0-9]{32}$/.test(token)) notFound();

  const db = getAdminDbAdapter();
  const target = await db.getTargetByBadgeToken(token);
  if (target) {
    const trust = toPublicTrustProjection(target);
    if (!trust) notFound();
    const freshness = await resolveTargetFreshness(db, target);
    const verdictLabel = publicVerdictLabel(trust.verdict, freshness);

    const badgeSrc = `/api/badge/${token}`;
    return (
      <main className="report-page trust-page">
        <div className="report-page-inner">
          <div className="report-page-toolbar">
            <ThemeToggle />
          </div>
          <header className="report-page-header">
            <p className="report-page-eyebrow">Verified by Assurly</p>
            <h1>{trust.displayName}</h1>
            <p className="report-page-meta">
              {verdictLabel}
              {trust.shipScore !== null ? ` · Ship Score ${trust.shipScore}/100` : ''}
              {' · '}
              {formatFreshness(trust.lastCheckedAt)}
            </p>
            <StaleNotice freshness={freshness} />
          </header>

          <p className="trust-page__badge-wrap">
            <a href={badgeSrc}>
              {/* Badge is a dynamic SVG API route — native img is intentional. */}
              <img
                className="trust-page__badge"
                src={badgeSrc}
                alt={`Assurly · Ship Score ${trust.shipScore ?? '—'}/100`}
                height={28}
              />
            </a>
          </p>

          <section className="trust-page__verdict" aria-label="Current verdict">
            <p className="trust-page__score">
              {trust.shipScore === null ? '—' : trust.shipScore}
              <span>/100</span>
            </p>
            <p className="trust-page__status">{verdictLabel}</p>
            {trust.topIssue ? (
              <p className="trust-page__issue">
                <strong>{trust.topIssue.severity === 'error' ? 'Blocker' : 'Review'}</strong> —{' '}
                {trust.topIssue.category}
              </p>
            ) : trust.verdict === 'ready' ? (
              <p className="trust-page__issue">No blockers on the last check.</p>
            ) : null}
            <p className="trust-page__freshness">{formatFreshness(trust.lastCheckedAt)}</p>
          </section>

          <p className="trust-page__footer">
            Continuous monitoring by{' '}
            <a href="https://assurly.dev" rel="noopener noreferrer">
              Assurly
            </a>
            . Proof is shape-only — personal data is never shown on this page.
          </p>
        </div>
      </main>
    );
  }

  const scan = await db.getScanByShareToken(token);
  if (!scan) notFound();
  const scanFreshness = await resolveScanFreshness(db, scan);

  const [findings, repositoryName] = await Promise.all([
    db.getScanFindings(scan.id),
    db.getRepositoryNameForScan(scan.id),
  ]);

  const affectedPaths = new Set(findings.map((finding) => finding.file_path));
  const shipGate = buildShipGateFromScanFindings(findings, {
    scannedFileCount: Math.max(affectedPaths.size, 1),
    cleanFileCount: 0,
  });
  // The panel above already shows coverage and setup; old scans also carry a
  // CI nag that tells people to run someone else's `npx shipready` package.
  const issueFindings = findings.filter((finding) =>
    isIssueFinding({ ruleId: finding.rule_id, message: finding.message }),
  );

  return (
    <main className="report-page">
      <div className="report-page-inner">
        <div className="report-page-toolbar">
          <ThemeToggle />
        </div>
        <header className="report-page-header">
          <p className="report-page-eyebrow">Assurly Ship Gate Report</p>
          <h1>{repositoryName ?? 'Repository scan'}</h1>
          <p className="report-page-meta">
            Commit <code>{scan.commit_sha.slice(0, 7)}</code> on branch{' '}
            <strong>{scan.branch}</strong> · Checked {formatScanDateTime(scan.created_at)}
          </p>
          <StaleNotice freshness={scanFreshness} />
        </header>

        <ShipGatePanel report={shipGate} />

        {issueFindings.length > 0 ? (
          <section className="report-findings" aria-label="Detailed findings">
            <h2>Detailed findings</h2>
            <ul className="report-findings-list">
              {issueFindings.map((finding) => (
                <li
                  key={finding.id}
                  className={`report-finding report-finding--${finding.severity}`}
                >
                  <div className="report-finding-header">
                    <span className="report-finding-severity">{finding.severity}</span>
                    <span className="report-finding-file">
                      {finding.file_path}
                      {finding.line_number ? `:L${finding.line_number}` : ''}
                    </span>
                  </div>
                  <p>{finding.message}</p>
                  {finding.suggestion ? (
                    <p className="report-finding-suggestion">Suggestion: {finding.suggestion}</p>
                  ) : null}
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>
    </main>
  );
}
