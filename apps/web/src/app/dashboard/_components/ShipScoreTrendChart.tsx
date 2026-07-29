'use client';

import { useEffect, useState, type ReactElement } from 'react';

export interface ShipScoreTrendPoint {
  date: string;
  shipScore: number;
}

interface ShipScoreTrendChartProps {
  repositoryId: string;
  fetchTrend: (repositoryId: string) => Promise<{ points: ShipScoreTrendPoint[] }>;
  /**
   * Optional first-paint seed (e.g. E2E fixture). When provided, the chart is
   * ready during SSR/hydration so locale-sensitive labels are actually compared.
   */
  initialPoints?: ShipScoreTrendPoint[];
}

interface TrendState {
  repositoryId: string;
  status: 'loading' | 'ready' | 'error';
  points: ShipScoreTrendPoint[];
}

/** Locale-pinned short date for trend labels — must stay deterministic across SSR. */
export function formatTrendDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  // Pin en-US so Node SSR and the browser agree (see ProofEvidence.tsx).
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function buildTrendPath(points: ShipScoreTrendPoint[], width: number, height: number): string {
  if (points.length === 0) return '';
  const xStep = points.length === 1 ? 0 : width / (points.length - 1);
  return points
    .map((point, index) => {
      const x = index * xStep;
      const y = height - (point.shipScore / 100) * height;
      return `${index === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(' ');
}

export function ShipScoreTrendChart({
  repositoryId,
  fetchTrend,
  initialPoints,
}: ShipScoreTrendChartProps): ReactElement | null {
  const seeded = initialPoints !== undefined && initialPoints.length > 0;
  const [trendState, setTrendState] = useState<TrendState>({
    repositoryId,
    status: seeded ? 'ready' : 'loading',
    points: seeded ? initialPoints : [],
  });

  useEffect(() => {
    let cancelled = false;
    void fetchTrend(repositoryId)
      .then((result) => {
        if (cancelled) return;
        setTrendState({
          repositoryId,
          status: 'ready',
          points: result.points,
        });
      })
      .catch(() => {
        if (cancelled) return;
        setTrendState({
          repositoryId,
          status: 'error',
          points: [],
        });
      });
    return () => {
      cancelled = true;
    };
  }, [fetchTrend, repositoryId]);

  const isStale = trendState.repositoryId !== repositoryId;
  const status = isStale ? 'loading' : trendState.status;
  const points = isStale ? [] : trendState.points;

  if (status === 'loading') {
    return (
      <section className="ship-score-trend" aria-label="Ship Score trend" aria-busy="true">
        <p className="ship-score-trend__label">Ship Score trend</p>
        <p className="ship-score-trend__meta">Loading trend…</p>
      </section>
    );
  }

  if (status === 'error' || points.length === 0) {
    return (
      <section className="ship-score-trend" aria-label="Ship Score trend">
        <p className="ship-score-trend__label">Ship Score trend</p>
        <p className="ship-score-trend__meta">
          {status === 'error' ? 'Trend unavailable.' : 'Run more scans to see a trend.'}
        </p>
      </section>
    );
  }

  const width = 280;
  const height = 72;
  const path = buildTrendPath(points, width, height);
  const latest = points[points.length - 1];

  return (
    <section className="ship-score-trend" aria-label="Ship Score trend">
      <div className="ship-score-trend__header">
        <p className="ship-score-trend__label">Ship Score trend</p>
        <p className="ship-score-trend__meta">
          Latest {latest.shipScore}/100 · {formatTrendDate(latest.date)}
        </p>
      </div>
      <svg
        className="ship-score-trend__chart"
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={`Ship Score trend from ${formatTrendDate(points[0].date)} to ${formatTrendDate(latest.date)}`}
      >
        <line x1="0" y1={height} x2={width} y2={height} className="ship-score-trend__axis" />
        <path d={path} className="ship-score-trend__line" fill="none" />
      </svg>
    </section>
  );
}
