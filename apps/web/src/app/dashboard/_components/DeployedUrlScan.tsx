'use client';

import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactElement } from 'react';
import type { WebFinding } from '../../../utils/browserScanner';
import { ClientApiError, clientApi } from '../../../utils/clientApi';
import { formatCount } from '../../../utils/pluralize';
import {
  describeBlockedScan,
  parseBlockedScan,
  type BlockedScan,
} from '../../../utils/scannerBlocked';
import { scrollDashboardElement } from '../../../utils/scrollToScanDetails';
import type { ShipGateReport } from '../../../utils/shipGate';
import { isLikelyScannableUrl } from '../../../utils/urlValidation';
import type { VisibilityCheck, VisibilityVerdict } from '../../../utils/visibilityScan';
import { ShipGatePanel } from '../../_components/ship-gate/ShipGatePanel';
import { DeepReviewPanel, type DeepReviewView } from './DeepReviewPanel';
import { AlertPreferences } from './AlertPreferences';
import { CanarySilentAlarm } from './CanarySilentAlarm';
import { OwnershipVerify } from './OwnershipVerify';
import { ProofEvidence, type ProofEvidenceItem } from './ProofEvidence';
import { VisibilityAuditPanel, type VisibilityView } from './VisibilityAuditPanel';

export interface DeployedUrlScanProps {
  loginUrl?: string;
}

interface ScanTarget {
  id: string;
  ownershipVerified: boolean;
}

interface UrlScanResults {
  targetUrl: string;
  shipGate: ShipGateReport;
  findings: WebFinding[];
  evidence: ProofEvidenceItem[];
  target: ScanTarget | null;
  /** Paid Layer-2 review — absent for free tier / AI unavailable / passive scan. */
  deepReview: DeepReviewView | null;
  /** Pro user, ownership not verified yet — deep review unlocks on verification. */
  deepReviewLocked: boolean;
  /** SEO & GEO audit — parallel to Ship Gate; absent when the scanner skipped it. */
  visibility: VisibilityView | null;
  /** Free / anonymous — headline only; check detail is a paid unlock. */
  visibilityLocked: boolean;
}

const VISIBILITY_VERDICTS = new Set<VisibilityVerdict>(['visible', 'partial', 'invisible']);

function parseVisibility(raw: unknown): VisibilityView | null {
  if (!raw || typeof raw !== 'object') return null;
  const record = raw as Record<string, unknown>;
  if (typeof record.score !== 'number' || typeof record.aiReadinessScore !== 'number') {
    return null;
  }
  if (typeof record.searchReadinessScore !== 'number') return null;
  if (
    typeof record.verdict !== 'string' ||
    !VISIBILITY_VERDICTS.has(record.verdict as VisibilityVerdict)
  ) {
    return null;
  }

  const view: VisibilityView = {
    score: record.score,
    aiReadinessScore: record.aiReadinessScore,
    searchReadinessScore: record.searchReadinessScore,
    verdict: record.verdict as VisibilityVerdict,
  };

  if (Array.isArray(record.checks)) {
    const checks: VisibilityCheck[] = [];
    for (const item of record.checks) {
      if (!item || typeof item !== 'object') continue;
      const row = item as Record<string, unknown>;
      if (typeof row.id !== 'string' || typeof row.title !== 'string') continue;
      if (typeof row.status !== 'string' || typeof row.detail !== 'string') continue;
      if (row.group !== 'ai' && row.group !== 'search') continue;
      if (
        row.status !== 'pass' &&
        row.status !== 'warn' &&
        row.status !== 'fail' &&
        row.status !== 'skipped'
      ) {
        continue;
      }
      checks.push({
        id: row.id,
        title: row.title,
        group: row.group,
        status: row.status,
        detail: row.detail,
        ...(typeof row.fix === 'string' ? { fix: row.fix } : {}),
      });
    }
    if (checks.length > 0) view.checks = checks;
  }

  return view;
}

function parseDeepReview(raw: unknown): DeepReviewView | null {
  if (!raw || typeof raw !== 'object') return null;
  const record = raw as Record<string, unknown>;
  if (typeof record.summary !== 'string' || !record.summary.trim()) return null;
  if (record.source !== 'ai') return null;

  const findings: DeepReviewView['findings'] = [];
  if (Array.isArray(record.findings)) {
    for (const item of record.findings) {
      if (!item || typeof item !== 'object') continue;
      const row = item as Record<string, unknown>;
      const title = typeof row.title === 'string' ? row.title.trim() : '';
      const risk = typeof row.risk === 'string' ? row.risk.trim() : '';
      const recommendation =
        typeof row.recommendation === 'string' ? row.recommendation.trim() : '';
      if (title && risk) {
        findings.push({
          title,
          risk,
          recommendation: recommendation || 'Review with your developer.',
        });
      }
    }
  }

  return { summary: record.summary.trim(), findings, source: 'ai' };
}

async function readScanUrlError(response: Response): Promise<string> {
  try {
    const data = (await response.json()) as { error?: { message?: unknown } };
    const message = data.error?.message;
    if (typeof message === 'string' && message.trim()) return message;
  } catch {
    // Fall through to a generic message.
  }
  return response.statusText || `Request failed with status ${response.status}.`;
}

/** Everything a caller needs to render the input card and the results canvas. */
export interface DeployedUrlScanState {
  urlInput: string;
  setUrlInput: (value: string) => void;
  isValidUrl: boolean;
  showInvalidHint: boolean;
  isScanning: boolean;
  scanError: string | null;
  scanResults: UrlScanResults | null;
  /** The target refused the probe — an honest "unknown" instead of a verdict. */
  scanBlocked: BlockedScan | null;
  handleSubmit: (event?: FormEvent) => Promise<void>;
  runScan: (targetUrl: string) => Promise<void>;
  /** Attach a newly created guarded target to the current results (no re-scan). */
  attachTarget: (target: ScanTarget) => void;
  /** True once a scan has started — the results canvas has something to show. */
  hasActivity: boolean;
}

/**
 * Owns all deployed-URL scan state and I/O. Split out from the rendering so the
 * compact INPUT card can live in the left toolbar while the wide RESULTS canvas
 * renders in the same right-hand slot the repo scan uses — one results space,
 * short page (see DeployedUrlScanCard / DeployedUrlScanResults).
 *
 * `onActivate` fires when a scan starts, so the dashboard can switch the shared
 * results canvas to the URL view ("last action wins").
 * `onScanComplete` fires after a successful scan so the dashboard can refresh
 * the "Your apps" verdict cards.
 */
export function useDeployedUrlScan(
  onActivate?: () => void,
  onScanComplete?: () => void,
): DeployedUrlScanState {
  const [urlInput, setUrlInput] = useState('');
  const [isScanning, setIsScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [scanResults, setScanResults] = useState<UrlScanResults | null>(null);
  const [scanBlocked, setScanBlocked] = useState<BlockedScan | null>(null);

  // Keep the latest callbacks without making runScan change identity every render.
  const onActivateRef = useRef(onActivate);
  const onScanCompleteRef = useRef(onScanComplete);
  useEffect(() => {
    onActivateRef.current = onActivate;
  }, [onActivate]);
  useEffect(() => {
    onScanCompleteRef.current = onScanComplete;
  }, [onScanComplete]);

  const isValidUrl = isLikelyScannableUrl(urlInput);
  const showInvalidHint = urlInput.trim().length > 0 && !isValidUrl;

  const attachTarget = useCallback((target: ScanTarget): void => {
    setScanResults((current) => (current ? { ...current, target } : current));
  }, []);

  const runScan = useCallback(async (targetUrl: string): Promise<void> => {
    onActivateRef.current?.();
    setIsScanning(true);
    setScanError(null);
    setScanBlocked(null);

    try {
      const response = await fetch('/api/scan-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: targetUrl }),
      });

      if (!response.ok) {
        throw new Error(await readScanUrlError(response));
      }

      const data = (await response.json()) as {
        report: ShipGateReport;
        findings: WebFinding[];
        evidence?: ProofEvidenceItem[];
        target?: ScanTarget | null;
        deepReview?: unknown;
        deepReviewLocked?: unknown;
        visibility?: unknown;
        visibilityLocked?: unknown;
        blocked?: unknown;
      };

      const blocked = parseBlockedScan(data.blocked);
      if (blocked) {
        setScanBlocked(blocked);
        setScanResults(null);
        return;
      }

      setScanResults({
        targetUrl,
        shipGate: data.report,
        findings: data.findings,
        evidence: data.evidence ?? [],
        target: data.target ?? null,
        deepReview: parseDeepReview(data.deepReview),
        deepReviewLocked: data.deepReviewLocked === true,
        visibility: parseVisibility(data.visibility),
        visibilityLocked: data.visibilityLocked === true,
      });
      onScanCompleteRef.current?.();
    } catch (error: unknown) {
      setScanError(error instanceof Error ? error.message : 'URL scan failed.');
    } finally {
      setIsScanning(false);
    }
  }, []);

  const handleSubmit = useCallback(
    async (event?: FormEvent): Promise<void> => {
      event?.preventDefault();
      const trimmed = urlInput.trim();
      if (!isLikelyScannableUrl(urlInput) || isScanning) return;
      setScanResults(null);
      await runScan(trimmed);
    },
    [urlInput, isScanning, runScan],
  );

  return {
    urlInput,
    setUrlInput,
    isValidUrl,
    showInvalidHint,
    isScanning,
    scanError,
    scanResults,
    scanBlocked,
    handleSubmit,
    runScan,
    attachTarget,
    hasActivity: isScanning || scanResults !== null || scanError !== null || scanBlocked !== null,
  };
}

/** The compact input card — lives in the left toolbar beside the other scan tools. */
export function DeployedUrlScanCard({ scan }: { scan: DeployedUrlScanState }): ReactElement {
  return (
    <section className="dashboard-public-connect" aria-label="Scan deployed URL">
      <h4 className="dashboard-public-connect__title">Scan a Deployed URL</h4>
      <p className="dashboard-public-connect__copy">
        Paste your live app URL to probe runtime security without repository access.
      </p>

      <form
        className="dashboard-public-connect__form"
        onSubmit={(event) => void scan.handleSubmit(event)}
      >
        <label className="visually-hidden" htmlFor="dashboard-deployed-url">
          Deployed application URL
        </label>
        <input
          id="dashboard-deployed-url"
          type="url"
          className="dashboard-public-connect__input"
          placeholder="https://myapp.lovable.app"
          value={scan.urlInput}
          onChange={(event) => scan.setUrlInput(event.target.value)}
          disabled={scan.isScanning}
          aria-invalid={scan.showInvalidHint}
          aria-describedby={scan.showInvalidHint ? 'dashboard-deployed-url-hint' : undefined}
        />
        <button
          type="submit"
          className="dashboard-public-connect__submit"
          disabled={scan.isScanning || !scan.isValidUrl}
          aria-busy={scan.isScanning}
        >
          {scan.isScanning ? 'Scanning...' : 'Scan URL'}
        </button>
      </form>

      {scan.showInvalidHint ? (
        <p id="dashboard-deployed-url-hint" className="dashboard-public-connect__hint">
          Enter a full URL including https:// — for example https://myapp.lovable.app
        </p>
      ) : null}
    </section>
  );
}

/**
 * The honest-unknown state: the target answered but would not let the scanner
 * in. It deliberately shows no Ship Score and no verdict — a WAF-protected app
 * must not read as failing, and a page we never saw must not read as passing.
 */
function BlockedScanNotice({ blocked }: { blocked: BlockedScan }): ReactElement {
  const copy = describeBlockedScan(blocked);
  return (
    <div data-testid="url-scan-blocked">
      <h3 className="dashboard-empty-state__title">{copy.title}</h3>
      <p className="dashboard-empty-state__copy">{copy.detail}</p>
      <p className="dashboard-empty-state__copy">
        No Ship Score is shown, because we would be guessing. {copy.nextStep}
      </p>
    </div>
  );
}

/**
 * The wide results canvas — renders in the same right-hand slot as the repo scan
 * workspace, so a URL scan's live proof + ship gate + follow-ups get full width
 * instead of a tall, narrow column.
 */
export function DeployedUrlScanResults({
  scan,
  loginUrl = '/api/auth/login',
  onGuarded,
}: {
  scan: DeployedUrlScanState;
  loginUrl?: string;
  /** Fires after the user explicitly adds this URL to Your apps. */
  onGuarded?: () => void;
}): ReactElement {
  const { scanResults, isScanning, scanError, scanBlocked, attachTarget } = scan;
  const resultsRef = useRef<HTMLElement>(null);
  const [isGuarding, setIsGuarding] = useState(false);
  const [guardError, setGuardError] = useState<string | null>(null);

  // When a scan finishes and the results appear, bring the user straight to the
  // top of the results canvas — otherwise they're left scrolled down by the input
  // tools and have to scroll up to see what they just ran.
  useEffect(() => {
    if (scanResults && resultsRef.current) {
      scrollDashboardElement(resultsRef.current);
    }
  }, [scanResults]);

  const handleGuardUrl = useCallback(async (): Promise<void> => {
    if (!scanResults) return;
    setIsGuarding(true);
    setGuardError(null);
    try {
      const { target } = await clientApi.createUrlTarget(scanResults.targetUrl);
      attachTarget({ id: target.id, ownershipVerified: target.ownershipVerified });
      onGuarded?.();
      // Re-scan so the new target receives a Ship Gate projection on the card.
      void scan.runScan(scanResults.targetUrl);
    } catch (error) {
      setGuardError(
        error instanceof ClientApiError ? error.message : 'Could not add this URL to Your apps.',
      );
    } finally {
      setIsGuarding(false);
    }
  }, [attachTarget, onGuarded, scan, scanResults]);

  if (!scanResults) {
    return (
      <section className="dashboard-scan-workspace" aria-label="Deployed URL scan results">
        <div className="dashboard-empty-state dashboard-empty-state--panel">
          {isScanning ? (
            <>
              <span className="dashboard-empty-state__icon" aria-hidden="true">
                <span className="dashboard-inline-spinner" />
              </span>
              <h3 className="dashboard-empty-state__title">Probing your live URL…</h3>
              <p className="dashboard-empty-state__copy">
                Running a safe, passive runtime probe. This takes a few seconds.
              </p>
            </>
          ) : scanBlocked ? (
            <BlockedScanNotice blocked={scanBlocked} />
          ) : scanError ? (
            <>
              <h3 className="dashboard-empty-state__title">URL scan failed</h3>
              <p className="dashboard-empty-state__copy">{scanError}</p>
            </>
          ) : (
            <>
              <h3 className="dashboard-empty-state__title">No URL scanned yet</h3>
              <p className="dashboard-empty-state__copy">
                Paste a live app URL on the left and run a scan to see its runtime verdict here.
              </p>
            </>
          )}
        </div>
      </section>
    );
  }

  return (
    <section
      ref={resultsRef}
      className="dashboard-scan-workspace"
      aria-label="Deployed URL scan results"
    >
      <div className="dashboard-url-scan-results">
        <ProofEvidence evidence={scanResults.evidence} />
        <div className="scanner-results-card scanner-results-card--ship-gate">
          <div className="scanner-results-info">
            <h4>Ship Gate for {scanResults.targetUrl}</h4>
            <p>
              Runtime probe results — {formatCount(scanResults.findings.length, 'finding')}{' '}
              detected.
              {!scanResults.target
                ? ' This one-off probe is not added to Your apps until you guard it.'
                : ''}
            </p>
          </div>
          <ShipGatePanel report={scanResults.shipGate} />
        </div>
        {/* Guard CTA sits directly under Ship Gate so one-off probes always show
            a clear path to Your apps — not buried under SEO / deep-review copy. */}
        {!scanResults.target ? (
          <div className="dashboard-guard-url" data-testid="guard-url-cta">
            <p className="dashboard-guard-url__eyebrow">Save to Your apps</p>
            <p className="dashboard-guard-url__copy">
              This was a one-off probe — it is not in Your apps yet. Guard this URL, then prove
              ownership to keep Continuous Guardian watching it.
            </p>
            {guardError ? (
              <p className="dashboard-guard-url__error" role="alert">
                {guardError}
              </p>
            ) : null}
            <button
              type="button"
              className="dashboard-public-connect__submit"
              onClick={() => void handleGuardUrl()}
              disabled={isGuarding}
              data-testid="guard-url-button"
            >
              {isGuarding ? 'Adding…' : 'Guard this URL'}
            </button>
          </div>
        ) : null}
        {scanResults.target && !scanResults.target.ownershipVerified ? (
          <OwnershipVerify
            targetId={scanResults.target.id}
            identifier={scanResults.targetUrl}
            onVerified={() => {
              onGuarded?.();
              void scan.runScan(scanResults.targetUrl);
            }}
          />
        ) : null}
        {scanResults.visibility ? (
          <VisibilityAuditPanel
            report={scanResults.visibility}
            locked={scanResults.visibilityLocked}
          />
        ) : null}
        {scanResults.deepReview ? (
          <DeepReviewPanel review={scanResults.deepReview} />
        ) : scanResults.deepReviewLocked ? (
          <p className="deep-review-locked" data-testid="deep-review-locked">
            <span className="deep-review-locked__eyebrow">AI deep review</span>
            <span className="deep-review-locked__lock" aria-hidden="true">
              🔒
            </span>{' '}
            Guard this URL and verify ownership above to unlock a Pro-level, app-specific threat
            analysis — it reasons about your live app’s real attack surface, not a generic
            checklist.
          </p>
        ) : null}
        {scanResults.target?.ownershipVerified ? (
          <>
            <AlertPreferences targetId={scanResults.target.id} />
            <CanarySilentAlarm targetId={scanResults.target.id} />
          </>
        ) : null}
        <p className="dashboard-url-scan-hint">
          This is a runtime probe of your live URL — fix the items above on your host or in your
          deploy config. To also scan your source code (RLS, exposed secrets, undocumented env vars,
          CI) and open auto-fix pull requests for those,{' '}
          <a href={loginUrl} className="dashboard-url-scan-link">
            sign in with GitHub
          </a>{' '}
          and connect a repository.
        </p>
      </div>
    </section>
  );
}

/**
 * Standalone composer (input card + results stacked). Used outside the dashboard
 * grid — e.g. tests. Inside the dashboard, the card and results are placed in
 * separate columns via `useDeployedUrlScan` (see DashboardClient).
 */
export function DeployedUrlScan({
  loginUrl = '/api/auth/login',
}: DeployedUrlScanProps): ReactElement {
  const scan = useDeployedUrlScan();
  return (
    <>
      <DeployedUrlScanCard scan={scan} />
      {scan.hasActivity ? <DeployedUrlScanResults scan={scan} loginUrl={loginUrl} /> : null}
    </>
  );
}
