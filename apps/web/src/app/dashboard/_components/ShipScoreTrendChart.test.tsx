// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildTrendPath,
  formatTrendDate,
  MIN_TREND_POINTS,
  ShipScoreTrendChart,
} from './ShipScoreTrendChart';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('formatTrendDate', () => {
  it('returns the pinned en-US short month/day for a fixed ISO input', () => {
    // Midday UTC so the calendar day is stable across common local offsets.
    expect(formatTrendDate('2026-06-26T12:00:00.000Z')).toBe('Jun 26');
    expect(formatTrendDate('2026-07-28T12:00:00.000Z')).toBe('Jul 28');
    expect(formatTrendDate('not-a-date')).toBe('not-a-date');
  });

  it('passes en-US explicitly so ambient locale cannot change the output', () => {
    const spy = vi.spyOn(Date.prototype, 'toLocaleDateString');
    formatTrendDate('2026-06-26T12:00:00.000Z');
    expect(spy).toHaveBeenCalledWith('en-US', { month: 'short', day: 'numeric' });
  });
});

describe('buildTrendPath', () => {
  it('returns an empty path until there are at least two points', () => {
    expect(MIN_TREND_POINTS).toBe(2);
    expect(buildTrendPath([], 280, 72)).toBe('');
    expect(buildTrendPath([{ date: '2026-01-01T00:00:00.000Z', shipScore: 88 }], 280, 72)).toBe('');
  });

  it('builds a multi-point path for a real series', () => {
    const path = buildTrendPath(
      [
        { date: '2026-01-01T00:00:00.000Z', shipScore: 100 },
        { date: '2026-01-02T00:00:00.000Z', shipScore: 50 },
      ],
      280,
      72,
    );
    expect(path.startsWith('M')).toBe(true);
    expect(path.includes(' L')).toBe(true);
  });
});

describe('ShipScoreTrendChart', () => {
  it('renders the trend when two or more scans are available', async () => {
    render(
      <ShipScoreTrendChart
        repositoryId="repo-1"
        fetchTrend={vi.fn().mockResolvedValue({
          points: [
            { date: '2026-01-01T00:00:00.000Z', shipScore: 100 },
            { date: '2026-01-02T00:00:00.000Z', shipScore: 88 },
          ],
        })}
      />,
    );

    await waitFor(() => {
      expect(screen.getByLabelText('Ship Score trend')).toBeTruthy();
      expect(screen.getByText(/Latest 88\/100/)).toBeTruthy();
    });
    expect(screen.queryByTestId('ship-score-trend-empty')).toBeNull();
    expect(screen.getByRole('img', { name: /Ship Score trend from/i })).toBeTruthy();
  });

  it('shows an intentional empty state for a single scan — not a broken one-point chart', async () => {
    render(
      <ShipScoreTrendChart
        repositoryId="repo-1"
        fetchTrend={vi.fn().mockResolvedValue({
          points: [{ date: '2026-01-02T12:00:00.000Z', shipScore: 88 }],
        })}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId('ship-score-trend-empty')).toBeTruthy();
    });

    expect(screen.getByText(/First scan · 88\/100/)).toBeTruthy();
    expect(screen.getByText(/Trend unlocks after the next scan/i)).toBeTruthy();
    expect(screen.getByText(/One data point is a score, not a trend/i)).toBeTruthy();
    expect(screen.queryByRole('img', { name: /Ship Score trend from/i })).toBeNull();
    expect(document.querySelector('.ship-score-trend__line')).toBeNull();
  });

  it('shows a no-scans empty state when the series is empty', async () => {
    render(
      <ShipScoreTrendChart
        repositoryId="repo-1"
        fetchTrend={vi.fn().mockResolvedValue({ points: [] })}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId('ship-score-trend-empty')).toBeTruthy();
    });
    expect(screen.getByText(/No scans yet/i)).toBeTruthy();
    expect(screen.getByText(/Run a scan on this repository/i)).toBeTruthy();
  });

  it('shows a clear error status when the trend fetch fails', async () => {
    render(
      <ShipScoreTrendChart
        repositoryId="repo-1"
        fetchTrend={vi.fn().mockRejectedValue(new Error('network'))}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText(/Trend unavailable/i)).toBeTruthy();
    });
    expect(screen.queryByTestId('ship-score-trend-empty')).toBeNull();
  });
});
