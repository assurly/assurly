// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { DashboardSplash } from './DashboardSplash';

describe('DashboardSplash', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    cleanup();
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    document.body.style.overflow = '';
  });

  it('types the command and calls onDone exactly once after the full duration', () => {
    const onDone = vi.fn();
    render(<DashboardSplash onDone={onDone} durationMs={4000} />);

    expect(screen.getByTestId('dashboard-splash')).toBeTruthy();
    expect(screen.getByLabelText('Signing you in to Assurly')).toBeTruthy();

    // The command types out character by character over the first ~1.7s.
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(screen.getByText('assurly scan')).toBeTruthy();

    // Still on screen before the 4s lifetime elapses.
    act(() => {
      vi.advanceTimersByTime(1500);
    });
    expect(onDone).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('locks background scroll while mounted and restores it on unmount', () => {
    const { unmount } = render(<DashboardSplash onDone={() => undefined} />);
    expect(document.body.style.overflow).toBe('hidden');

    unmount();
    expect(document.body.style.overflow).toBe('');
  });
});
