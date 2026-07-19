'use client';

import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactElement } from 'react';
import type { WebFinding } from '../../../utils/browserScanner';
import type { ShipGateReport } from '../../../utils/shipGate';
import { isLikelyScannableUrl } from '../../../utils/urlValidation';
import { ShipGatePanel } from '../../_components/ship-gate/ShipGatePanel';
import { DeepReviewPanel, type DeepReviewView } from './DeepReviewPanel';
import { AlertPreferences } from './AlertPreferences';
import { OwnershipVerify } from './OwnershipVerify';
import { ProofEvidence, type ProofEvidenceItem } from './ProofEvidence';

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
  handleSubmit: (event?: FormEvent) => Promise<void>;
  runScan: (targetUrl: string) => Promise<void>;
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
 */
export function useDeployedUrlScan(onActivate?: () => void): DeployedUrlScanState {
  const [urlInput, setUrlInput] = useState('');
  const [isScanning, setIsScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [scanResults, setScanResults] = useState<UrlScanResults | null>(null);

  // Keep the latest callback without making runScan change identity every render.
  const onActivateRef = useRef(onActivate);
  onActivateRef.current = onActivate;

  const isValidUrl = isLikelyScannableUrl(urlInput);
  const showInvalidHint = urlInput.trim().length > 0 && !isValidUrl;

  const runScan = useCallback(async (targetUrl: string): Promise<void> => {
    onActivateRef.current?.();
    setIsScanning(true);
    setScanError(null);

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
      };
      setScanResults({
        targetUrl,
        shipGate: data.report,
        findings: data.findings,
        evidence: data.evidence ?? [],
        target: data.target ?? null,
        deepReview: parseDeepReview(data.deepReview),
        deepReviewLocked: data.deepReviewLocked === true,
      });
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
    handleSubmit,
    runScan,
    hasActivity: isScanning || scanResults !== null || scanError !== null,
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
 * The wide results canvas — renders in the same right-hand slot as the repo scan
 * workspace, so a URL scan's live proof + ship gate + follow-ups get full width
 * instead of a tall, narrow column.
 */
export function DeployedUrlScanResults({
  scan,
  loginUrl = '/api/auth/login',
}: {
  scan: DeployedUrlScanState;
  loginUrl?: string;
}): ReactElement {
  const { scanResults, isScanning, scanError } = scan;
  const resultsRef = useRef<HTMLElement>(null);

  // When a scan finishes and the results appear, bring the user straight to the
  // top of the results canvas — otherwise they're left scrolled down by the input
  // tools and have to scroll up to see what they just ran.
  useEffect(() => {
    if (scanResults) {
      // Optional-call: `scrollIntoView` is absent in jsdom (tests) but present in
      // every real browser, so this scrolls in the app and no-ops under test.
      resultsRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
    }
  }, [scanResults]);

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
              Runtime probe results — {scanResults.findings.length} finding
              {scanResults.findings.length === 1 ? '' : 's'} detected.
            </p>
          </div>
          <ShipGatePanel report={scanResults.shipGate} />
        </div>
        {scanResults.deepReview ? (
          <DeepReviewPanel review={scanResults.deepReview} />
        ) : scanResults.deepReviewLocked ? (
          <p className="deep-review-locked" data-testid="deep-review-locked">
            <span className="deep-review-locked__eyebrow">AI deep review</span>
            <span className="deep-review-locked__lock" aria-hidden="true">
              🔒
            </span>{' '}
            Verify ownership below to unlock a Pro-level, app-specific threat analysis — it reasons
            about your live app’s real attack surface, not a generic checklist.
          </p>
        ) : null}
        {scanResults.target && !scanResults.target.ownershipVerified ? (
          <OwnershipVerify
            targetId={scanResults.target.id}
            identifier={scanResults.targetUrl}
            onVerified={() => void scan.runScan(scanResults.targetUrl)}
          />
        ) : null}
        {scanResults.target?.ownershipVerified ? (
          <AlertPreferences targetId={scanResults.target.id} />
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
