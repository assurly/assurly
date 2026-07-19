// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Scan } from '../../../utils/dbAdapter';
import { ScanHistoryRail } from './ScanHistoryRail';

const sharedSha = '669c0392ea81119689959fdbe63b05c3c95ce544';

function buildScan(overrides: Partial<Scan> & Pick<Scan, 'id'>): Scan {
  return {
    repository_id: 'repo-1',
    commit_sha: sharedSha,
    branch: 'main',
    status: 'failed',
    error_count: 1,
    warning_count: 0,
    created_at: '2026-06-26T08:55:00.000Z',
    ...overrides,
  };
}

const scans: Scan[] = [
  buildScan({ id: 'scan-1', created_at: '2026-06-26T08:00:00.000Z' }),
  buildScan({ id: 'scan-2', created_at: '2026-06-26T08:30:00.000Z' }),
  buildScan({ id: 'scan-3', created_at: '2026-06-26T08:55:00.000Z' }),
  buildScan({
    id: 'scan-4',
    commit_sha: 'deadbeefffffffffffffffffffffffffffffffff',
    status: 'success',
    created_at: '2026-06-26T09:10:00.000Z',
  }),
];

describe('ScanHistoryRail', () => {
  beforeEach(() => {
    Element.prototype.scrollIntoView = vi.fn();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('renders a horizontally scrollable rail with scan count heading', () => {
    render(<ScanHistoryRail scans={scans} selectedScanId="scan-1" onSelectScan={vi.fn()} />);

    expect(screen.getByRole('heading', { name: 'Scan history (4)' })).toBeTruthy();
    expect(screen.getByTestId('scan-history-rail')).toBeTruthy();

    const rail = screen.getByRole('tablist', { name: 'Select scan by commit' });
    expect(rail.className).toContain('scan-history-rail');
    expect(screen.getByTestId('scan-history-rail').className).toContain('scan-history');
  });

  it('labels chips with commit SHA, time, and duplicate badges', () => {
    render(<ScanHistoryRail scans={scans} selectedScanId="scan-2" onSelectScan={vi.fn()} />);

    expect(screen.getAllByRole('tab', { name: /commit 669c039 ·/i }).length).toBe(3);
    expect(screen.getAllByText('#1 of 3').length).toBeGreaterThan(0);
    expect(screen.getAllByText('#2 of 3').length).toBeGreaterThan(0);
    expect(screen.getAllByText('#3 of 3').length).toBeGreaterThan(0);
    expect(screen.queryByText(/#1 of 1/i)).toBeNull();
  });

  it('marks the selected scan and calls onSelectScan when a chip is clicked', () => {
    const onSelectScan = vi.fn();

    render(<ScanHistoryRail scans={scans} selectedScanId="scan-1" onSelectScan={onSelectScan} />);

    const selectedTab = screen.getByTestId('scan-history-chip-scan-1');
    expect(selectedTab.getAttribute('aria-selected')).toBe('true');
    expect(screen.getByTestId('scan-history-chip-scan-2').getAttribute('aria-selected')).toBe(
      'false',
    );

    fireEvent.click(screen.getByTestId('scan-history-chip-scan-4'));
    expect(onSelectScan).toHaveBeenCalledWith(scans[3]);
  });

  it('reveals the active chip horizontally without scrolling the page vertically', () => {
    const scrollIntoView = vi.spyOn(Element.prototype, 'scrollIntoView');
    const scrollBy = vi.fn();
    Element.prototype.scrollBy = scrollBy;

    const { rerender } = render(
      <ScanHistoryRail scans={scans} selectedScanId="scan-1" onSelectScan={vi.fn()} />,
    );

    const rail = screen.getByRole('tablist', { name: 'Select scan by commit' });
    // Rail viewport spans x=0..200; the newly-selected chip sits off to the right.
    vi.spyOn(rail, 'getBoundingClientRect').mockReturnValue({ left: 0, right: 200 } as DOMRect);
    const chip4 = screen.getByTestId('scan-history-chip-scan-4');
    vi.spyOn(chip4, 'getBoundingClientRect').mockReturnValue({ left: 240, right: 320 } as DOMRect);

    scrollBy.mockClear();
    rerender(<ScanHistoryRail scans={scans} selectedScanId="scan-4" onSelectScan={vi.fn()} />);

    // Only the rail scrolls horizontally; the page-scrolling scrollIntoView is
    // never used, so the workspace above the rail stays put.
    expect(scrollIntoView).not.toHaveBeenCalled();
    expect(scrollBy).toHaveBeenCalledWith({ left: 320 - 200 + 8, behavior: 'smooth' });
    expect(scrollBy.mock.calls[0][0]).not.toHaveProperty('top');
  });

  it('contains horizontal scrolling inside the rail wrapper', () => {
    render(<ScanHistoryRail scans={scans} selectedScanId="scan-1" onSelectScan={vi.fn()} />);

    const wrapper = screen.getByTestId('scan-history-rail');
    const rail = screen.getByRole('tablist', { name: 'Select scan by commit' });

    expect(wrapper.className).toContain('scan-history');
    expect(rail.className).toContain('scan-history-rail');
  });

  it('opens a confirm dialog from × without deleting until confirmed', () => {
    const onDeleteScan = vi.fn();
    render(
      <ScanHistoryRail
        scans={scans}
        selectedScanId="scan-3"
        onSelectScan={vi.fn()}
        onDeleteScan={onDeleteScan}
      />,
    );

    fireEvent.click(screen.getByTestId('scan-history-delete-scan-3'));

    expect(screen.getByTestId('scan-delete-dialog')).toBeTruthy();
    expect(screen.getByRole('dialog', { name: 'Delete scan?' })).toBeTruthy();
    expect(onDeleteScan).not.toHaveBeenCalled();
  });

  it('closes the confirm dialog via Cancel without calling onDeleteScan', () => {
    const onDeleteScan = vi.fn();
    render(
      <ScanHistoryRail
        scans={scans}
        selectedScanId="scan-3"
        onSelectScan={vi.fn()}
        onDeleteScan={onDeleteScan}
      />,
    );

    fireEvent.click(screen.getByTestId('scan-history-delete-scan-3'));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByTestId('scan-delete-dialog')).toBeNull();
    expect(onDeleteScan).not.toHaveBeenCalled();
  });

  it('closes the confirm dialog via Escape without calling onDeleteScan', () => {
    const onDeleteScan = vi.fn();
    render(
      <ScanHistoryRail
        scans={scans}
        selectedScanId="scan-3"
        onSelectScan={vi.fn()}
        onDeleteScan={onDeleteScan}
      />,
    );

    fireEvent.click(screen.getByTestId('scan-history-delete-scan-3'));
    fireEvent.keyDown(document, { key: 'Escape' });

    expect(screen.queryByTestId('scan-delete-dialog')).toBeNull();
    expect(onDeleteScan).not.toHaveBeenCalled();
  });

  it('calls onDeleteScan with the target scan when Delete scan is confirmed', () => {
    const onDeleteScan = vi.fn();
    render(
      <ScanHistoryRail
        scans={scans}
        selectedScanId="scan-3"
        onSelectScan={vi.fn()}
        onDeleteScan={onDeleteScan}
      />,
    );

    fireEvent.click(screen.getByTestId('scan-history-delete-scan-3'));
    fireEvent.click(screen.getByRole('button', { name: 'Delete scan' }));

    expect(onDeleteScan).toHaveBeenCalledTimes(1);
    expect(onDeleteScan).toHaveBeenCalledWith(scans[2]);
    expect(screen.queryByTestId('scan-delete-dialog')).toBeNull();
  });
});
