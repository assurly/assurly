import { notFound } from 'next/navigation';
import type { ReactElement } from 'react';
import { ShipGatePanel } from '../../_components/ship-gate/ShipGatePanel';
import { buildShipGateFromScanFindings } from '../../../utils/shipGate';
import { getAdminDbAdapter } from '../../../utils/dbAdapter';

interface ReportPageProps {
  params: Promise<{ token: string }>;
}

export default async function ReportPage({ params }: ReportPageProps): Promise<ReactElement> {
  const { token } = await params;
  if (!/^[a-f0-9]{32}$/.test(token)) notFound();

  const db = getAdminDbAdapter();
  const scan = await db.getScanByShareToken(token);
  if (!scan) notFound();

  const [findings, repositoryName] = await Promise.all([
    db.getScanFindings(scan.id),
    db.getRepositoryNameForScan(scan.id),
  ]);

  const affectedPaths = new Set(findings.map((finding) => finding.file_path));
  const shipGate = buildShipGateFromScanFindings(findings, {
    scannedFileCount: Math.max(affectedPaths.size, 1),
    cleanFileCount: 0,
  });

  return (
    <main className="report-page">
      <div className="report-page-inner">
        <header className="report-page-header">
          <p className="report-page-eyebrow">Assurly Ship Gate Report</p>
          <h1>{repositoryName ?? 'Repository scan'}</h1>
          <p className="report-page-meta">
            Commit <code>{scan.commit_sha.slice(0, 7)}</code> on branch{' '}
            <strong>{scan.branch}</strong>
          </p>
        </header>

        <ShipGatePanel report={shipGate} />

        {findings.length > 0 ? (
          <section className="report-findings" aria-label="Detailed findings">
            <h2>Detailed findings</h2>
            <ul className="report-findings-list">
              {findings.map((finding) => (
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
