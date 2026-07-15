'use client';

import type { ReactElement } from 'react';

/**
 * Client-safe shape of a Layer-2 deep review. Mirrors `DeepReviewResult` from
 * `utils/ai/deepReview.ts` without importing the server AI client.
 */
export interface DeepReviewFindingView {
  title: string;
  risk: string;
  recommendation: string;
}

export interface DeepReviewView {
  summary: string;
  findings: DeepReviewFindingView[];
  source: 'ai';
}

interface DeepReviewPanelProps {
  review: DeepReviewView;
}

/**
 * Paid Layer-2 deep review — collapsible under the Layer-1 verdict so proof-first
 * stays the hero. Renders nothing useful beyond what the API already returned;
 * when `review` is absent the caller simply omits this component.
 */
export function DeepReviewPanel({ review }: DeepReviewPanelProps): ReactElement {
  const findingCount = review.findings.length;
  const countLabel =
    findingCount === 0
      ? 'Deep review'
      : `${findingCount} deep risk${findingCount === 1 ? '' : 's'}`;

  return (
    <details className="deep-review" data-testid="deep-review" aria-label="AI deep security review">
      <summary className="deep-review__summary">
        <span className="deep-review__eyebrow">AI deep review</span>
        <span className="deep-review__count">{countLabel}</span>
      </summary>

      <div className="deep-review__body">
        <p className="deep-review__lede">{review.summary}</p>

        {findingCount > 0 ? (
          <ol className="deep-review__list">
            {review.findings.map((finding) => (
              <li key={finding.title} className="deep-review__item">
                <h5 className="deep-review__title">{finding.title}</h5>
                <p className="deep-review__risk">{finding.risk}</p>
                <p className="deep-review__recommendation">
                  <span className="deep-review__rec-label">Fix</span>
                  {finding.recommendation}
                </p>
              </li>
            ))}
          </ol>
        ) : null}
      </div>
    </details>
  );
}
