// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Scan } from '../../../utils/dbAdapter';
import { ScanHistoryRail } from './ScanHistoryRail';
import { SCAN_HISTORY_RAIL_EDGE_INSET } from './scanHistoryRailOverflow';

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
    class FakeResizeObserver {
      observe(): void {}
      disconnect(): void {}
      unobserve(): void {}
    }
    vi.stubGlobal('ResizeObserver', FakeResizeObserver);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('renders a horizontally scrollable rail with scan count heading', () => {
    render(<ScanHistoryRail scans={scans} selectedScanId="scan-3" onSelectScan={vi.fn()} />);

    expect(screen.getByRole('heading', { name: 'Scan history (4)' })).toBeTruthy();
    expect(screen.getByTestId('scan-history-rail')).toBeTruthy();

    const rail = screen.getByRole('list', { name: 'Select a scan' });
    expect(rail.className).toContain('scan-history-rail');
    expect(screen.getByTestId('scan-history-rail').className).toContain('scan-history');
  });

  it('labels chips with commit SHA, date, and time, and keeps every scan', () => {
    render(<ScanHistoryRail scans={scans} selectedScanId="scan-3" onSelectScan={vi.fn()} />);

    expect(screen.getAllByRole('button', { name: /commit 669c039/i }).length).toBe(3);
    expect(screen.getAllByRole('button', { name: /commit deadbee/i }).length).toBe(1);
    expect(screen.getAllByRole('button', { name: /commit 669c039/i })[0]?.textContent).toMatch(
      /[A-Z][a-z]{2} \d{1,2}, \d{4} · \d{2}:\d{2}/,
    );
    expect(screen.queryByText(/#1 of 3/i)).toBeNull();
    expect(screen.getByTestId('scan-history-chip-scan-1')).toBeTruthy();
    expect(screen.getByTestId('scan-history-chip-scan-3')).toBeTruthy();
    expect(
      screen.getByTestId('scan-history-chip-scan-3').querySelector('.scan-history-rail__when'),
    ).toBeTruthy();
  });

  it('renders chips newest first so the latest scan is first in the rail', () => {
    render(<ScanHistoryRail scans={scans} selectedScanId="scan-3" onSelectScan={vi.fn()} />);

    const chips = screen.getAllByTestId(/scan-history-chip-/);
    expect(chips.map((chip) => chip.getAttribute('data-testid'))).toEqual([
      'scan-history-chip-scan-4',
      'scan-history-chip-scan-3',
      'scan-history-chip-scan-2',
      'scan-history-chip-scan-1',
    ]);
  });

  it('marks the selected scan and calls onSelectScan when a chip is clicked', () => {
    const onSelectScan = vi.fn();

    render(<ScanHistoryRail scans={scans} selectedScanId="scan-3" onSelectScan={onSelectScan} />);

    // The rail is a list, not a tablist, so the selected scan is marked with
    // `aria-current` — the unselected chips carry no attribute at all.
    const selectedChip = screen.getByTestId('scan-history-chip-scan-3');
    expect(selectedChip.getAttribute('aria-current')).toBe('true');
    expect(screen.getByTestId('scan-history-chip-scan-4').getAttribute('aria-current')).toBeNull();

    fireEvent.click(screen.getByTestId('scan-history-chip-scan-4'));
    expect(onSelectScan).toHaveBeenCalledWith(scans[3]);
  });

  it('reveals the active chip horizontally without scrolling the page vertically', () => {
    const scrollIntoView = vi.spyOn(Element.prototype, 'scrollIntoView');
    const scrollBy = vi.fn();
    Element.prototype.scrollBy = scrollBy;

    const { rerender } = render(
      <ScanHistoryRail scans={scans} selectedScanId="scan-3" onSelectScan={vi.fn()} />,
    );

    const rail = screen.getByRole('list', { name: 'Select a scan' });
    // Rail viewport spans x=0..200; the newly-selected chip sits off to the right.
    vi.spyOn(rail, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      right: 200,
      top: 0,
      bottom: 40,
    } as DOMRect);
    const chip4 = screen.getByTestId('scan-history-chip-scan-4');
    vi.spyOn(chip4, 'getBoundingClientRect').mockReturnValue({
      left: 240,
      right: 320,
      top: 0,
      bottom: 40,
    } as DOMRect);

    scrollBy.mockClear();
    rerender(<ScanHistoryRail scans={scans} selectedScanId="scan-4" onSelectScan={vi.fn()} />);

    // Only the rail scrolls; the page-scrolling scrollIntoView is never used.
    expect(scrollIntoView).not.toHaveBeenCalled();
    expect(scrollBy).toHaveBeenCalledWith({
      left: 320 - (200 - SCAN_HISTORY_RAIL_EDGE_INSET),
      top: 0,
      behavior: 'smooth',
    });
  });

  it('contains horizontal scrolling inside the rail wrapper', () => {
    render(<ScanHistoryRail scans={scans} selectedScanId="scan-1" onSelectScan={vi.fn()} />);

    const wrapper = screen.getByTestId('scan-history-rail');
    const rail = screen.getByRole('list', { name: 'Select a scan' });

    expect(wrapper.className).toContain('scan-history');
    expect(rail.className).toContain('scan-history-rail');
    expect(rail.parentElement?.className).toContain('scan-history-rail-viewport');
  });

  it('does not mark edge overflow when the rail content fits', () => {
    render(<ScanHistoryRail scans={scans} selectedScanId="scan-1" onSelectScan={vi.fn()} />);

    const viewport = screen.getByRole('list', { name: 'Select a scan' }).parentElement;
    expect(viewport?.getAttribute('data-overflow-start')).toBeNull();
    expect(viewport?.getAttribute('data-overflow-end')).toBeNull();
  });

  it('marks overflow-end at the start of a scrollable rail and overflow-start after scrolling', () => {
    render(<ScanHistoryRail scans={scans} selectedScanId="scan-1" onSelectScan={vi.fn()} />);

    const rail = screen.getByRole('list', { name: 'Select a scan' });
    const viewport = rail.parentElement;
    const metrics = { scrollLeft: 0, scrollWidth: 400, clientWidth: 200 };

    Object.defineProperty(rail, 'scrollWidth', {
      configurable: true,
      get: () => metrics.scrollWidth,
    });
    Object.defineProperty(rail, 'clientWidth', {
      configurable: true,
      get: () => metrics.clientWidth,
    });
    Object.defineProperty(rail, 'scrollLeft', {
      configurable: true,
      get: () => metrics.scrollLeft,
    });

    fireEvent.scroll(rail);
    expect(viewport?.getAttribute('data-overflow-start')).toBeNull();
    expect(viewport?.getAttribute('data-overflow-end')).toBe('true');

    metrics.scrollLeft = 80;
    fireEvent.scroll(rail);
    expect(viewport?.getAttribute('data-overflow-start')).toBe('true');
    expect(viewport?.getAttribute('data-overflow-end')).toBe('true');

    metrics.scrollLeft = 200;
    fireEvent.scroll(rail);
    expect(viewport?.getAttribute('data-overflow-start')).toBe('true');
    expect(viewport?.getAttribute('data-overflow-end')).toBeNull();
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
