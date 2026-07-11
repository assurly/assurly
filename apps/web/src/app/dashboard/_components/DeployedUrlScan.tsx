'use client';

import { useState, type FormEvent, type ReactElement } from 'react';
import type { WebFinding } from '../../../utils/browserScanner';
import type { ShipGateReport } from '../../../utils/shipGate';
import { isLikelyScannableUrl } from '../../../utils/urlValidation';
import { ShipGatePanel } from '../../_components/ship-gate/ShipGatePanel';

export interface DeployedUrlScanProps {
  loginUrl?: string;
}

interface UrlScanResults {
  targetUrl: string;
  shipGate: ShipGateReport;
  findings: WebFinding[];
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

export function DeployedUrlScan({
  loginUrl = '/api/auth/login',
}: DeployedUrlScanProps): ReactElement {
  const [urlInput, setUrlInput] = useState('');
  const [isScanning, setIsScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [scanResults, setScanResults] = useState<UrlScanResults | null>(null);

  const isValidUrl = isLikelyScannableUrl(urlInput);
  const showInvalidHint = urlInput.trim().length > 0 && !isValidUrl;

  const handleSubmit = async (event?: FormEvent): Promise<void> => {
    event?.preventDefault();
    const trimmed = urlInput.trim();
    if (!isValidUrl || isScanning) return;

    setIsScanning(true);
    setScanError(null);
    setScanResults(null);

    try {
      const response = await fetch('/api/scan-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: trimmed }),
      });

      if (!response.ok) {
        throw new Error(await readScanUrlError(response));
      }

      const data = (await response.json()) as { report: ShipGateReport; findings: WebFinding[] };
      setScanResults({
        targetUrl: trimmed,
        shipGate: data.report,
        findings: data.findings,
      });
    } catch (error: unknown) {
      setScanError(error instanceof Error ? error.message : 'URL scan failed.');
    } finally {
      setIsScanning(false);
    }
  };

  return (
    <section className="dashboard-public-connect" aria-label="Scan deployed URL">
      <h4 className="dashboard-public-connect__title">Scan a Deployed URL</h4>
      <p className="dashboard-public-connect__copy">
        Paste your live app URL to probe runtime security without repository access.
      </p>

      <form
        className="dashboard-public-connect__form"
        onSubmit={(event) => void handleSubmit(event)}
      >
        <label className="visually-hidden" htmlFor="dashboard-deployed-url">
          Deployed application URL
        </label>
        <input
          id="dashboard-deployed-url"
          type="url"
          className="dashboard-public-connect__input"
          placeholder="https://myapp.lovable.app"
          value={urlInput}
          onChange={(event) => setUrlInput(event.target.value)}
          disabled={isScanning}
          aria-invalid={showInvalidHint}
          aria-describedby={showInvalidHint ? 'dashboard-deployed-url-hint' : undefined}
        />
        <button
          type="submit"
          className="dashboard-public-connect__submit"
          disabled={isScanning || !isValidUrl}
          aria-busy={isScanning}
        >
          {isScanning ? 'Scanning...' : 'Scan URL'}
        </button>
      </form>

      {showInvalidHint ? (
        <p id="dashboard-deployed-url-hint" className="dashboard-public-connect__hint">
          Enter a full URL including https:// — for example https://myapp.lovable.app
        </p>
      ) : null}

      {scanError ? <p className="dashboard-public-connect__error">{scanError}</p> : null}

      {scanResults ? (
        <div className="dashboard-url-scan-results">
          <div className="scanner-results-card scanner-results-card--ship-gate">
            <div className="scanner-results-info">
              <h4>Ship Gate for {scanResults.targetUrl}</h4>
              <p>
                Runtime probe results — {scanResults.findings.length} finding
                {scanResults.findings.length === 1 ? '' : 's'} detected.
              </p>
            </div>
            <ShipGatePanel report={scanResults.shipGate} compact />
          </div>
          <p className="dashboard-url-scan-hint">
            This is a runtime probe of your live URL — fix the items above on your host or in your
            deploy config. To also scan your source code (RLS, exposed secrets, undocumented env
            vars, CI) and open auto-fix pull requests for those,{' '}
            <a href={loginUrl} className="dashboard-url-scan-link">
              sign in with GitHub
            </a>{' '}
            and connect a repository.
          </p>
        </div>
      ) : null}
    </section>
  );
}
