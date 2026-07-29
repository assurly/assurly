// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { formatTrendDate, ShipScoreTrendChart } from './ShipScoreTrendChart';

describe('formatTrendDate', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

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

describe('ShipScoreTrendChart', () => {
  it('renders the trend when data is available', async () => {
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
  });
});
