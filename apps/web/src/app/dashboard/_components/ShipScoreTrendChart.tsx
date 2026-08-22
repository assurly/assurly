'use client';

import { useEffect, useState, type ReactElement } from 'react';

/** A trend needs at least two scans — a single point is not a line. */
export const MIN_TREND_POINTS = 2;

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
  /** Refetch when scan history identity changes (new commit or replaced SHA). */
  refreshKey?: string;
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

/** Builds an SVG path for 2+ points. Returns '' for insufficient series. */
export function buildTrendPath(
  points: ShipScoreTrendPoint[],
  width: number,
  height: number,
): string {
  if (points.length < MIN_TREND_POINTS) return '';
  const xStep = width / (points.length - 1);
  return points
    .map((point, index) => {
      const x = index * xStep;
      const y = height - (point.shipScore / 100) * height;
      return `${index === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(' ');
}

function TrendShell({
  children,
  busy = false,
}: {
  children: ReactElement | ReactElement[];
  busy?: boolean;
}): ReactElement {
  return (
    <section
      className="ship-score-trend"
      aria-label="Ship Score trend"
      aria-busy={busy || undefined}
    >
      {children}
    </section>
  );
}

function InsufficientTrendState({ points }: { points: ShipScoreTrendPoint[] }): ReactElement {
  const first = points[0];
  const hasFirstScan = Boolean(first);

  return (
    <TrendShell>
      <div className="ship-score-trend__header">
        <p className="ship-score-trend__label">Ship Score trend</p>
        {hasFirstScan ? (
          <p className="ship-score-trend__meta">
            First scan · {first.shipScore}/100 · {formatTrendDate(first.date)}
          </p>
        ) : (
          <p className="ship-score-trend__meta">Not enough data yet</p>
        )}
      </div>

      <div className="ship-score-trend__empty" role="status" data-testid="ship-score-trend-empty">
        <svg
          className="ship-score-trend__empty-viz"
          viewBox="0 0 280 72"
          aria-hidden="true"
          focusable="false"
        >
          {/* Baseline */}
          <line x1="0" y1="64" x2="280" y2="64" className="ship-score-trend__axis" />
          {/* Ghost path — future trend shape, not a real series */}
          <path
            d="M24,40 C90,40 120,28 160,34 S230,22 256,26"
            className="ship-score-trend__ghost"
            fill="none"
          />
          {hasFirstScan ? (
            <circle
              cx="24"
              cy={64 - (first.shipScore / 100) * 56}
              r="4.5"
              className="ship-score-trend__point"
            />
          ) : (
            <circle
              cx="24"
              cy="40"
              r="4.5"
              className="ship-score-trend__point ship-score-trend__point--muted"
            />
          )}
        </svg>

        <div className="ship-score-trend__empty-copy">
          <p className="ship-score-trend__empty-title">
            {hasFirstScan ? 'Trend unlocks after a new commit' : 'No scans yet'}
          </p>
          <p className="ship-score-trend__empty-body">
            {hasFirstScan
              ? 'Scanning the same commit keeps one point. Push a new commit, then scan, to see how Ship Score moves.'
              : 'Run a scan on this repository to start tracking Ship Score over time.'}
          </p>
        </div>
      </div>
    </TrendShell>
  );
}

export function ShipScoreTrendChart({
  repositoryId,
  fetchTrend,
  initialPoints,
  refreshKey,
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
  }, [fetchTrend, repositoryId, refreshKey]);

  const isStale = trendState.repositoryId !== repositoryId;
  const status = isStale ? 'loading' : trendState.status;
  const points = isStale ? [] : trendState.points;

  if (status === 'loading') {
    return (
      <TrendShell busy>
        <p className="ship-score-trend__label">Ship Score trend</p>
        <p className="ship-score-trend__meta">Loading trend…</p>
      </TrendShell>
    );
  }

  if (status === 'error') {
    return (
      <TrendShell>
        <p className="ship-score-trend__label">Ship Score trend</p>
        <p className="ship-score-trend__meta" role="status">
          Trend unavailable. Try again after the next scan.
        </p>
      </TrendShell>
    );
  }

  if (points.length < MIN_TREND_POINTS) {
    return <InsufficientTrendState points={points} />;
  }

  const width = 280;
  const height = 72;
  const path = buildTrendPath(points, width, height);
  const latest = points[points.length - 1]!;
  const first = points[0]!;

  return (
    <TrendShell>
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
        aria-label={`Ship Score trend from ${formatTrendDate(first.date)} to ${formatTrendDate(latest.date)}`}
      >
        <line x1="0" y1={height} x2={width} y2={height} className="ship-score-trend__axis" />
        <path d={path} className="ship-score-trend__line" fill="none" />
      </svg>
    </TrendShell>
  );
}
