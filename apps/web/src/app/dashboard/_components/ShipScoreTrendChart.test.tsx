// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ShipScoreTrendChart } from './ShipScoreTrendChart';

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
