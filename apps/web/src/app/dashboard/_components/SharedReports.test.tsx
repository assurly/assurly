// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SharedReport } from '../../../utils/clientApi';

const api = vi.hoisted(() => ({ sharedReports: vi.fn(), stopSharingScan: vi.fn() }));
vi.mock('../../../utils/clientApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../utils/clientApi')>()),
  clientApi: api,
}));

import { SharedReports } from './SharedReports';

const ANIMA: SharedReport = {
  scanId: '22000000-0000-4000-8000-000000000002',
  repositoryName: 'tibco87/Anima',
  branch: 'main',
  commitSha: '254acca0000000000000000000000000000000000',
  verdict: 'blocked',
  shipScore: 59,
  createdAt: '2026-10-15T03:32:46.128Z',
  url: `https://assurly.dev/report/${'b'.repeat(32)}`,
};

beforeEach(() => {
  api.sharedReports.mockReset();
  api.stopSharingScan.mockReset();
});

afterEach(() => {
  cleanup();
});

describe('SharedReports', () => {
  it('lists each public link with what it exposes', async () => {
    api.sharedReports.mockResolvedValue({ shares: [ANIMA] });
    render(<SharedReports />);

    const link = await screen.findByRole('link', { name: 'tibco87/Anima' });
    expect(link.getAttribute('href')).toBe(ANIMA.url);
    expect(screen.getByText(/main · 254acca · .* · Not ready to ship/)).toBeTruthy();
  });

  it('stops a link only after the consequence is confirmed', async () => {
    api.sharedReports.mockResolvedValue({ shares: [ANIMA] });
    api.stopSharingScan.mockResolvedValue(undefined);
    render(<SharedReports />);

    fireEvent.click(await screen.findByRole('button', { name: 'Stop sharing' }));
    expect(api.stopSharingScan).not.toHaveBeenCalled();
    expect(screen.getByText(/README badge stops showing/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Stop sharing' }));
    await waitFor(() => expect(api.stopSharingScan).toHaveBeenCalledWith(ANIMA.scanId));
    expect(await screen.findByText('No report is shared publicly.')).toBeTruthy();
  });

  it('keeps the link listed and says so when stopping fails', async () => {
    api.sharedReports.mockResolvedValue({ shares: [ANIMA] });
    api.stopSharingScan.mockRejectedValue(new Error('Scan not found.'));
    render(<SharedReports />);

    fireEvent.click(await screen.findByRole('button', { name: 'Stop sharing' }));
    fireEvent.click(screen.getByRole('button', { name: 'Stop sharing' }));

    expect((await screen.findByRole('alert')).textContent).toBe('Scan not found.');
    expect(screen.getByRole('link', { name: 'tibco87/Anima' })).toBeTruthy();
  });

  it('can back out of stopping', async () => {
    api.sharedReports.mockResolvedValue({ shares: [ANIMA] });
    render(<SharedReports />);

    fireEvent.click(await screen.findByRole('button', { name: 'Stop sharing' }));
    fireEvent.click(screen.getByRole('button', { name: 'Keep sharing' }));
    expect(api.stopSharingScan).not.toHaveBeenCalled();
    expect(screen.queryByText(/README badge stops showing/)).toBeNull();
  });

  it('says so when nothing is shared', async () => {
    api.sharedReports.mockResolvedValue({ shares: [] });
    render(<SharedReports />);
    expect(await screen.findByText('No report is shared publicly.')).toBeTruthy();
  });
});
