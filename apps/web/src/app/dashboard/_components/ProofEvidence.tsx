'use client';

import type { ReactElement } from 'react';

/**
 * Client-safe shape of a redacted probe evidence item. Mirrors the scanner's
 * `ProbeEvidence` but carries no server-only imports, so it is safe in the
 * browser. Values are ALREADY redacted by the scanner — never raw PII.
 */
export interface ProofEvidenceItem {
  findingRuleId: string;
  kind: 'rls_rows' | 'exposed_secret' | 'open_endpoint' | 'missing_header';
  summary: string;
  redactedSample?: {
    rowCount?: number;
    columns?: string[];
    sampleCell?: string;
    table?: string;
    secretLabel?: string;
    maskedSecret?: string;
    headers?: string[];
  };
}

interface ProofEvidenceProps {
  evidence: ProofEvidenceItem[];
}

// Most alarming proof first — a live data pull outranks a leaked secret, an open
// endpoint, then a missing header.
const KIND_PRIORITY: Record<ProofEvidenceItem['kind'], number> = {
  rls_rows: 0,
  exposed_secret: 1,
  open_endpoint: 2,
  missing_header: 3,
};

function selectHeadline(evidence: ProofEvidenceItem[]): ProofEvidenceItem | null {
  if (evidence.length === 0) return null;
  return [...evidence].sort((a, b) => KIND_PRIORITY[a.kind] - KIND_PRIORITY[b.kind])[0];
}

function EvidenceDetail({ item }: { item: ProofEvidenceItem }): ReactElement | null {
  const sample = item.redactedSample;
  if (!sample) return null;

  if (item.kind === 'rls_rows') {
    return (
      <dl className="proof-evidence__facts">
        {sample.table ? (
          <div className="proof-evidence__fact">
            <dt>Table</dt>
            <dd>
              <code>{sample.table}</code>
            </dd>
          </div>
        ) : null}
        {typeof sample.rowCount === 'number' ? (
          <div className="proof-evidence__fact">
            <dt>Rows exposed</dt>
            <dd>{sample.rowCount.toLocaleString('en-US')}</dd>
          </div>
        ) : null}
        {sample.columns && sample.columns.length > 0 ? (
          <div className="proof-evidence__fact">
            <dt>Columns</dt>
            <dd>{sample.columns.join(', ')}</dd>
          </div>
        ) : null}
        {sample.sampleCell ? (
          <div className="proof-evidence__fact">
            <dt>Sample (redacted)</dt>
            <dd>
              <code>{sample.sampleCell}</code>
            </dd>
          </div>
        ) : null}
      </dl>
    );
  }

  if (item.kind === 'exposed_secret' && sample.maskedSecret) {
    return (
      <p className="proof-evidence__secret">
        <code>{sample.maskedSecret}</code>
      </p>
    );
  }

  if (item.kind === 'missing_header' && sample.headers && sample.headers.length > 0) {
    return <p className="proof-evidence__headers">{sample.headers.join(', ')}</p>;
  }

  return null;
}

/**
 * Renders the redacted proof as the headline evidence — "we just read N rows
 * from your `users` table" — so the user feels the real consequence, not a
 * warning line. The most alarming item leads; the rest are listed below.
 */
export function ProofEvidence({ evidence }: ProofEvidenceProps): ReactElement | null {
  const headline = selectHeadline(evidence);
  if (!headline) return null;

  const rest = evidence.filter((item) => item !== headline);

  return (
    <section
      className="proof-evidence"
      aria-label="Proof of what an attacker can access"
      data-testid="proof-evidence"
    >
      <p className="proof-evidence__eyebrow">Live proof</p>
      <p className="proof-evidence__headline">{headline.summary}</p>
      <EvidenceDetail item={headline} />

      {rest.length > 0 ? (
        <ul className="proof-evidence__list">
          {rest.map((item, index) => (
            <li key={`${item.findingRuleId}-${index}`} className="proof-evidence__list-item">
              {item.summary}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
